//! The one-shot loopback signing-session server (step W4b).
//!
//! A [`SigningSession`] binds one approval id, one 256-bit one-time token and one
//! unsigned XDR to a `tiny_http` server on `127.0.0.1` with an ephemeral port.
//! The browser page (`app/src/bridge/**`, W4a) talks to exactly two endpoints:
//!
//! * `GET  /sign/payload?t=<token>` — the unsigned XDR, the owner address, the
//!   approval summary and its payload hash;
//! * `POST /sign/result?t=<token>` — the wallet's signed envelope, or a code.
//!
//! Everything the page assumes is enforced here, per `docs/freighter-bridge.md`:
//! `Host` must be the session's own origin, `Origin` must be absent or that same
//! origin, `POST` must be `application/json`, bodies are capped, the token is
//! compared in constant time and consumed on first accepted result, and every
//! response carries `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
//! No CORS header is ever emitted, so a cross-origin reader cannot read the
//! payload even if it guesses the token.
//!
//! The server never verifies the signature itself: it hands the posted body back
//! to the caller, which owns the independent Rust verification (so the same
//! session code can be driven by tests and by `bridge_selftest`).

use std::io::Read;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use subtle::ConstantTimeEq;

use crate::health::{HealthStatus, now_ms};
use crate::types::TxSummary;

/// Maximum accepted request body. A signed testnet envelope is ~1 KiB; the cap
/// keeps a hostile page from parking a large blob in memory.
pub const MAX_BODY_BYTES: usize = 64 * 1024;

/// The exact `Content-Security-Policy` the served page gets. The page is a
/// single bundle plus inline styles, so `'unsafe-inline'` is allowed for styles
/// only; scripts must be same-origin. Nothing external may be loaded. Frame
/// ancestors, form actions and connections are locked to the session origin.
pub const CSP: &str = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/// How long a session stays open before it is abandoned as a timeout. Long
/// enough for a human to unlock Freighter and approve, short enough that a
/// forgotten page cannot pin a thread forever.
pub const SESSION_TTL: Duration = Duration::from_secs(150);

/// What the payload endpoint returns. Field names match `BridgePayload` in
/// `app/src/bridge/types.ts` byte for byte.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgePayload {
    pub xdr: String,
    pub network_passphrase: String,
    pub address: String,
    pub payload_hash: String,
    pub summary: TxSummary,
}

/// The result page's `POST /sign/result` body. `ok` is a **boolean**
/// discriminator (`{ ok: true, … } | { ok: false, … }`), which serde's
/// internally-tagged enums cannot key on, so the wire shape is deserialized into
/// a private struct first and then mapped. Field names match `BridgeResult` in
/// `app/src/bridge/types.ts`.
#[derive(Debug, Clone, PartialEq)]
pub enum PageResult {
    Failure { code: String, error: String },
    Success { signed_xdr: String, signer_address: String },
}

/// The raw wire shape, before the boolean discriminator is interpreted.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPageResult {
    ok: bool,
    #[serde(default)]
    signed_xdr: Option<String>,
    #[serde(default)]
    signer_address: Option<String>,
    #[serde(default)]
    code: Option<String>,
    #[serde(default)]
    error: Option<String>,
}

impl<'de> Deserialize<'de> for PageResult {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let raw = RawPageResult::deserialize(deserializer)?;
        if raw.ok {
            let Some(signed_xdr) = raw.signed_xdr else {
                return Err(serde::de::Error::missing_field("signedXdr"));
            };
            Ok(Self::Success {
                signed_xdr,
                signer_address: raw.signer_address.unwrap_or_default(),
            })
        } else {
            Ok(Self::Failure {
                code: raw.code.unwrap_or_else(|| "error".to_string()),
                error: raw.error.unwrap_or_default(),
            })
        }
    }
}

/// What the server observed on the result endpoint.
#[derive(Debug, Clone, PartialEq)]
pub enum SessionOutcome {
    /// The page posted a signed envelope (already structurally parsed).
    Success(PageResult),
    /// The page posted a failure or the body was malformed / empty.
    Failure { code: String, message: String },
}

/// Builds a payload-specific browser response from the parsed page result.
pub fn outcome_from_page(result: PageResult) -> SessionOutcome {
    match result {
        PageResult::Success { .. } => SessionOutcome::Success(result),
        PageResult::Failure { code, error } => SessionOutcome::Failure {
            code: normalize_page_code(&code),
            message: if error.is_empty() {
                format!("the signing page reported {code}")
            } else {
                error
            },
        },
    }
}

/// Maps a page-reported failure code onto the bridge outcome vocabulary. An
/// unknown code is reported as the fail-closed `error`, never a success.
fn normalize_page_code(code: &str) -> String {
    for known in [
        "rejected",
        "address_mismatch",
        "network_mismatch",
        "wallet_unavailable",
        "error",
    ] {
        if code == known {
            return known.to_string();
        }
    }
    "error".to_string()
}

/// Mints a one-time token from the OS CSPRNG: 32 random bytes, lowercase hex.
pub fn random_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("the OS CSPRNG must be available");
    hex::encode(bytes)
}

/// Constant-time token comparison. The token is 256 bits, so its length is not a
/// secret; a length mismatch is answered immediately.
fn token_matches(provided: Option<&str>, expected: &str) -> bool {
    let Some(provided) = provided else {
        return false;
    };
    let (a, b) = (provided.as_bytes(), expected.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.ct_eq(b).into()
}

/// The session's public banner, ready for `open -a <browser>`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BridgeLaunch {
    pub url: String,
    pub origin: String,
    pub port: u16,
}

/// An optional asset provider. Embedding the frontend in the app is the
/// production path; dev builds without an embedded asset fall back to reading
/// `app/dist/*` and, when that is missing, answer with a clear build hint.
pub trait AssetProvider: Send + Sync {
    fn get(&self, path: &str) -> Option<ResolvedAsset>;
}

/// One resolved asset: its bytes and MIME type.
type ResolvedAsset = (Vec<u8>, String);

/// The resolver closure behind [`AppAssetProvider`].
type AssetLookup = Box<dyn Fn(&str) -> Option<ResolvedAsset> + Send + Sync>;

/// Rejects an asset request path that could escape the asset root: a relative
/// `..` component, a backslash, or a doubled slash (an absolute component). Both
/// providers apply it *before* the underlying resolver is consulted, because
/// Tauri's dev asset resolver joins the raw path without dropping `ParentDir`.
fn is_safe_asset_path(path: &str) -> bool {
    path.starts_with('/')
        && !path.contains("..")
        && !path.contains('\\')
        && !path.contains("//")
}

/// A provider backed by an [`tauri::AssetResolver`](tauri::Manager::asset_resolver).
pub struct AppAssetProvider {
    inner: AssetLookup,
}

impl AppAssetProvider {
    /// Wraps the running app's asset resolver. `/sign` maps to `bridge.html`.
    pub fn from_app_handle(app: &tauri::AppHandle) -> Self {
        let handle = app.clone();
        Self {
            inner: Box::new(move |path: &str| {
                let path = match path {
                    "/sign" | "/sign/" => "/bridge.html",
                    other => other,
                };
                handle.asset_resolver().get(path.to_string()).map(|asset| {
                    (asset.bytes().to_vec(), asset.mime_type().to_string())
                })
            }),
        }
    }
}

impl AssetProvider for AppAssetProvider {
    fn get(&self, path: &str) -> Option<ResolvedAsset> {
        if !is_safe_asset_path(path) {
            return None;
        }
        (self.inner)(path)
    }
}

/// A provider that reads a directory on disk (the dev fallback).
pub struct DirAssetProvider {
    root: std::path::PathBuf,
}

impl DirAssetProvider {
    pub fn new(root: impl Into<std::path::PathBuf>) -> Self {
        Self { root: root.into() }
    }
}

impl AssetProvider for DirAssetProvider {
    fn get(&self, path: &str) -> Option<ResolvedAsset> {
        if !is_safe_asset_path(path) {
            return None;
        }
        let relative = match path {
            "/sign" | "/sign/" => "bridge.html",
            "/" => "index.html",
            other => other.trim_start_matches('/'),
        };
        if relative.is_empty() {
            return None;
        }
        let candidate = self.root.join(relative);
        let bytes = std::fs::read(&candidate).ok()?;
        let mime = mime_for(relative).to_string();
        Some((bytes, mime))
    }
}

/// A conservative extension -> MIME map for the bridge's few asset types.
pub fn mime_for(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        _ => "application/octet-stream",
    }
}

/// A running signing session. Dropping it stops the server thread.
pub struct SigningSession {
    server: Arc<tiny_http::Server>,
    launch: BridgeLaunch,
    state: Arc<SessionState>,
}

impl SigningSession {
    /// Binds `127.0.0.1:0`, mints a token and starts serving on a background
    /// thread. Every request is handled synchronously on that thread.
    pub fn start(
        payload: BridgePayload,
        assets: Arc<dyn AssetProvider>,
        ttl: Duration,
    ) -> std::io::Result<Self> {
        let server = Arc::new(tiny_http::Server::http("127.0.0.1:0").map_err(|error| {
            std::io::Error::new(std::io::ErrorKind::AddrInUse, error.to_string())
        })?);
        let addr = server
            .server_addr()
            .to_ip()
            .ok_or_else(|| std::io::Error::other("not a TCP listener"))?;
        let port = addr.port();
        let origin = format!("http://127.0.0.1:{port}");
        let token = random_token();
        let url = format!("{origin}/sign?t={token}");

        let state = Arc::new(SessionState {
            payload,
            token,
            origin: origin.clone(),
            expires_at: Instant::now() + ttl,
            outcome: Mutex::new(None),
            completed: std::sync::atomic::AtomicBool::new(false),
        });

        let worker_server = Arc::clone(&server);
        let worker_state = Arc::clone(&state);
        std::thread::Builder::new()
            .name("polaris-bridge".to_string())
            .spawn(move || serve(worker_server, worker_state, assets))
            .map_err(|error| std::io::Error::other(error.to_string()))?;

        Ok(Self {
            server,
            launch: BridgeLaunch {
                url,
                origin,
                port,
            },
            state,
        })
    }

    /// The URL to open in the browser.
    pub fn launch(&self) -> &BridgeLaunch {
        &self.launch
    }

    /// Waits up to `timeout` for the page to post a result. Polls the tiny
    /// server's queue so the wait can be bounded; the handled request resolves
    /// the shared slot, so no request is ever lost between polls.
    pub fn wait_for_result(&self, timeout: Duration) -> Option<SessionOutcome> {
        let deadline = Instant::now() + timeout;
        loop {
            if let Some(outcome) = self.state.take_outcome() {
                return Some(outcome);
            }
            if Instant::now() >= deadline {
                return self.state.take_outcome();
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    /// Stops the server (unblocks its accept loop).
    pub fn shutdown(&self) {
        self.server.unblock();
    }
}

impl Drop for SigningSession {
    fn drop(&mut self) {
        self.shutdown();
    }
}

struct SessionState {
    payload: BridgePayload,
    token: String,
    origin: String,
    expires_at: Instant,
    /// The result, once posted, plus a `completed` latch that never clears. The
    /// latch is separate from the value so that reading the outcome (for the
    /// caller) does not make the session accept a second result: the token stays
    /// single-use even after the waiter has consumed the value.
    outcome: Mutex<Option<SessionOutcome>>,
    completed: std::sync::atomic::AtomicBool,
}

impl SessionState {
    fn expired(&self) -> bool {
        Instant::now() >= self.expires_at
    }

    fn take_outcome(&self) -> Option<SessionOutcome> {
        self.outcome.lock().unwrap().take()
    }

    /// Records the first result and returns whether this call won the race.
    fn complete(&self, outcome: SessionOutcome) -> bool {
        if self.completed.swap(true, std::sync::atomic::Ordering::SeqCst) {
            return false;
        }
        *self.outcome.lock().unwrap() = Some(outcome);
        true
    }
}

/// The accept loop. One request at a time; the session ends when the server is
/// unblocked (drop) — there is no other shutdown path.
fn serve(
    server: Arc<tiny_http::Server>,
    state: Arc<SessionState>,
    assets: Arc<dyn AssetProvider>,
) {
    loop {
        // A short timeout keeps the TTL check alive even when nothing arrives.
        let request = match server.recv_timeout(Duration::from_millis(200)) {
            Ok(Some(request)) => request,
            Ok(None) => continue,
            Err(_) => return,
        };
        if let Err(error) = handle_request(request, &state, assets.as_ref()) {
            eprintln!("polaris: bridge request failed: {error}");
        }
    }
}

/// The URL path (no query string), or `""` when the target is not a path.
fn path_of(url: &str) -> String {
    url.split(&['?', '#'][..]).next().unwrap_or("").to_string()
}

/// The raw value of a header (trimmed), or `None`. `name` must be a static
/// string because the case-insensitive comparison is against a literal.
fn header_value<'a>(request: &'a tiny_http::Request, name: &'static str) -> Option<&'a str> {
    request
        .headers()
        .iter()
        .find(|header| header.field.equiv(name))
        .map(|header| header.value.as_str().trim())
}

/// The `t` query parameter of a URL, percent-decoded.
fn query_token(url: &str) -> Option<String> {
    let query = url.split('?').nth(1)?;
    let query = query.split('#').next().unwrap_or(query);
    for pair in query.split('&') {
        let Some((key, value)) = pair.split_once('=') else {
            continue;
        };
        if key == "t" {
            return Some(percent_decode(value));
        }
    }
    None
}

/// Decodes `%XX` escapes; a malformed escape is kept verbatim.
fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).ok();
            if let Some(byte) = hex.and_then(|hex| u8::from_str_radix(hex, 16).ok()) {
                out.push(byte);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Handles one request, writing exactly one response.
fn handle_request(
    mut request: tiny_http::Request,
    state: &SessionState,
    assets: &dyn AssetProvider,
) -> std::io::Result<()> {
    let url = request.url().to_string();
    let path = path_of(&url);

    // Host and Origin are the DNS-rebinding guard: a page from anywhere but this
    // loopback origin (or with a forged Host) never reaches a handler.
    let host_ok = header_value(&request, "Host") == Some(state.origin["http://".len()..].as_ref());
    let origin_ok = match header_value(&request, "Origin") {
        Some(origin) => origin == state.origin,
        None => true,
    };
    if !host_ok || !origin_ok {
        return respond_error(request, 403, "forbidden host or origin");
    }

    let method = request.method().clone();

    if method == tiny_http::Method::Get && path == "/sign/payload" {
        if state.expired() {
            return respond_error(request, 410, "this signing session has expired");
        }
        if !token_matches(query_token(&url).as_deref(), &state.token) {
            return respond_error(request, 403, "unknown token");
        }
        return respond_json(request, 200, &state.payload);
    }

    if method == tiny_http::Method::Post && path == "/sign/result" {
        if state.expired() {
            return respond_error(request, 410, "this signing session has expired");
        }
        if !token_matches(query_token(&url).as_deref(), &state.token) {
            return respond_error(request, 403, "unknown token");
        }
        if !is_json_content_type(&request) {
            return respond_error(request, 415, "expected application/json");
        }
        if request
            .body_length()
            .map(|length| length > MAX_BODY_BYTES)
            .unwrap_or(false)
        {
            return respond_error(request, 413, "request body is too large");
        }
        let body = match read_body(request.as_reader(), MAX_BODY_BYTES) {
            Ok(Some(body)) => body,
            Ok(None) => return respond_error(request, 413, "request body is too large"),
            Err(_) => return respond_error(request, 400, "could not read the request body"),
        };
        let outcome = match serde_json::from_slice::<PageResult>(&body) {
            Ok(result) => outcome_from_page(result),
            Err(_) => SessionOutcome::Failure {
                code: "error".to_string(),
                message: "the signing page posted a malformed result".to_string(),
            },
        };
        // Single use: the first accepted result wins; a second post is refused
        // even if the first was a failure (the page may post at most once).
        if !state.complete(outcome) {
            return respond_error(request, 410, "this signing session is already complete");
        }
        return respond_no_content(request);
    }

    if method == tiny_http::Method::Get {
        return serve_static(request, &path, assets);
    }

    respond_error(request, 404, "not found")
}

/// True when the request's `Content-Type` is `application/json` (parameters
/// after a `;` are allowed, e.g. `; charset=utf-8`).
fn is_json_content_type(request: &tiny_http::Request) -> bool {
    header_value(request, "Content-Type")
        .map(|value| {
            value
                .split(';')
                .next()
                .unwrap_or("")
                .trim()
                .eq_ignore_ascii_case("application/json")
        })
        .unwrap_or(false)
}

/// Reads at most `max` bytes. `Ok(None)` means the body exceeded `max`; `Err`
/// means the read itself failed. Callers answer `413` for the former and `400`
/// for the latter, so a broken stream is never mistaken for an oversized body.
fn read_body(reader: &mut dyn Read, max: usize) -> std::io::Result<Option<Vec<u8>>> {
    let mut body = Vec::new();
    let mut limited = reader.take(max as u64 + 1);
    limited.read_to_end(&mut body)?;
    if body.len() > max {
        return Ok(None);
    }
    Ok(Some(body))
}

/// The response headers every reply carries.
fn base_headers() -> Vec<tiny_http::Header> {
    vec![
        tiny_http::Header::from_bytes(&b"Cache-Control"[..], &b"no-store"[..]).unwrap(),
        tiny_http::Header::from_bytes(&b"Referrer-Policy"[..], &b"no-referrer"[..]).unwrap(),
    ]
}

fn respond_error(
    request: tiny_http::Request,
    status: u16,
    message: &str,
) -> std::io::Result<()> {
    let body = serde_json::json!({ "error": message });
    let mut response = tiny_http::Response::from_data(body.to_string().into_bytes())
        .with_status_code(status)
        .with_header(
            tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
        );
    for header in base_headers() {
        response.add_header(header);
    }
    request.respond(response)
}

fn respond_json<T: Serialize>(
    request: tiny_http::Request,
    status: u16,
    body: &T,
) -> std::io::Result<()> {
    let bytes = serde_json::to_vec(body).unwrap_or_default();
    let mut response = tiny_http::Response::from_data(bytes)
        .with_status_code(status)
        .with_header(
            tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
        );
    for header in base_headers() {
        response.add_header(header);
    }
    request.respond(response)
}

fn respond_no_content(request: tiny_http::Request) -> std::io::Result<()> {
    let mut response = tiny_http::Response::empty(204);
    for header in base_headers() {
        response.add_header(header);
    }
    request.respond(response)
}

/// Serves the built bridge page and its assets from the provider.
fn serve_static(
    request: tiny_http::Request,
    path: &str,
    assets: &dyn AssetProvider,
) -> std::io::Result<()> {
    let Some((bytes, mime_type)) = assets.get(path) else {
        return respond_error(
            request,
            404,
            "the bridge page is not bundled; run `npm run build -w @polaris/app`",
        );
    };
    let mut response = tiny_http::Response::from_data(bytes).with_status_code(200);
    response.add_header(
        tiny_http::Header::from_bytes(&b"Content-Type"[..], mime_type.as_bytes())
            .expect("the MIME type is ASCII"),
    );
    response.add_header(
        tiny_http::Header::from_bytes(&b"Content-Security-Policy"[..], CSP.as_bytes())
            .expect("the CSP is ASCII"),
    );
    for header in base_headers() {
        response.add_header(header);
    }
    request.respond(response)
}

/// The non-prompting `bridge_health` check: can a listener bind on `127.0.0.1`,
/// are the page and its assets servable, is an owner address configured, and
/// which browser would open. Never shows a prompt and never moves funds.
pub fn health(
    assets: &dyn AssetProvider,
    owner_address: Option<&str>,
    browser: Option<&str>,
) -> crate::health::FeatureHealth {
    let Some(owner) = owner_address.filter(|address| !address.trim().is_empty()) else {
        return crate::health::FeatureHealth::new(
            HEALTH_ID,
            HEALTH_TITLE,
            MILESTONE,
            HealthStatus::Fail,
            "No owner address is configured; set POLARIS_OWNER_ADDRESS to a testnet G address.",
        );
    };
    if !crate::stellar_config::is_public_key(owner) {
        return crate::health::FeatureHealth::new(
            HEALTH_ID,
            HEALTH_TITLE,
            MILESTONE,
            HealthStatus::Fail,
            "POLARIS_OWNER_ADDRESS is not a valid G... address.",
        );
    }

    let Some((page, _)) = assets.get("/sign") else {
        return crate::health::FeatureHealth::new(
            HEALTH_ID,
            HEALTH_TITLE,
            MILESTONE,
            HealthStatus::Warn,
            "The bridge page is not available; run `npm run build -w @polaris/app` and restart.",
        );
    };
    let asset_path = html_asset_path(&page);
    let assets_ok = match asset_path.as_deref() {
        Some(asset) => assets.get(asset).is_some(),
        None => false,
    };

    let listener_ok = tiny_http::Server::http("127.0.0.1:0").is_ok();
    let browser = browser.unwrap_or("the default browser");

    let (status, detail) = match (listener_ok, assets_ok) {
        (true, true) => (
            HealthStatus::Ok,
            format!(
                "Loopback signing is ready for {}; Freighter must be in {}.",
                short(owner),
                browser
            ),
        ),
        (false, _) => (
            HealthStatus::Fail,
            "Could not bind a listener on 127.0.0.1; another process may be blocking loopback."
                .to_string(),
        ),
        (_, false) => (
            HealthStatus::Warn,
            "The bridge page loaded but its script asset is missing; rebuild with `npm run build -w @polaris/app`."
                .to_string(),
        ),
    };
    crate::health::FeatureHealth::new(HEALTH_ID, HEALTH_TITLE, MILESTONE, status, detail)
}

/// The first bundled script asset referenced by the page HTML, if any.
fn html_asset_path(page: &[u8]) -> Option<String> {
    let html = String::from_utf8_lossy(page);
    let marker = "src=\"";
    let start = html.find(marker)? + marker.len();
    let rest = &html[start..];
    let end = rest.find('"')?;
    let candidate = &rest[..end];
    if candidate.starts_with('/') {
        Some(candidate.to_string())
    } else {
        None
    }
}

/// A short, public owner reference for the health detail (never a secret).
fn short(address: &str) -> String {
    if address.len() > 10 {
        format!("{}…{}", &address[..5], &address[address.len() - 4..])
    } else {
        address.to_string()
    }
}

/// Feature-check id, shared by the Debug contract.
pub const HEALTH_ID: &str = "w4b.bridge";
/// Human title for the health check.
pub const HEALTH_TITLE: &str = "Freighter signing bridge";
/// The milestone this module's checks belong to.
pub const MILESTONE: &str = "W4b";

/// Non-prompting health command. `now_ms` is used by `FeatureHealth::new`; kept
/// here so a future async variant shares the same timestamp source.
#[allow(dead_code)]
fn health_timestamp() -> u64 {
    now_ms()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpStream;

    /// A tiny in-memory asset provider: `/sign` -> page HTML, one script asset.
    struct FakeAssets;

    impl AssetProvider for FakeAssets {
        fn get(&self, path: &str) -> Option<ResolvedAsset> {
            match path {
                "/sign" | "/sign/" => Some((
                    br#"<html><head></head><body><script type="module" src="/assets/bridge.js"></script></body></html>"#.to_vec(),
                    "text/html; charset=utf-8".to_string(),
                )),
                "/assets/bridge.js" => Some((b"console.log('bridge')".to_vec(), "text/javascript; charset=utf-8".to_string())),
                _ => None,
            }
        }
    }

    const PASSPHRASE: &str = "Test SDF Network ; September 2015";
    const OWNER: &str = "GAJW5V7VXHIRTJBGNVYTGXJ6CLDM7IEIPAYD3XLKKTKJKPRBYOTAC25A";

    fn payload() -> BridgePayload {
        BridgePayload {
            xdr: FIXTURE_XDR.to_string(),
            network_passphrase: PASSPHRASE.to_string(),
            address: OWNER.to_string(),
            payload_hash: "abc123".to_string(),
            summary: TxSummary {
                title: "Sign a testnet payment".to_string(),
                lines: vec!["Amount 1 XLM".to_string()],
                explorer_url: None,
                estimated_fee: "0.0000100 XLM".to_string(),
            },
        }
    }

    const FIXTURE_XDR: &str = "AAAAAgAAAAATbtf1udEZpCZtcTNdPhLGz6CIeDA93WpU1JU+IcOmAQAAAGQAAAAAAAAAAQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAQAAAAB12BBgnCJAQgcNtjAZbs7JSMucpHJJ3WuJHvwK+gBE6AAAAAAAAAAAAJiWgAAAAAAAAAAA";

    fn open() -> SigningSession {
        SigningSession::start(payload(), Arc::new(FakeAssets), Duration::from_secs(30)).unwrap()
    }

    /// A minimal blocking HTTP client for the loopback server: returns
    /// `(status, headers, body)`.
    fn request(
        session: &SigningSession,
        method: &str,
        target: &str,
        host: Option<&str>,
        origin: Option<&str>,
        content_type: Option<&str>,
        body: &[u8],
    ) -> (u16, Vec<(String, String)>, Vec<u8>) {
        let port = session.launch().port;
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut head = format!("{method} {target} HTTP/1.1\r\n");
        head.push_str(&format!(
            "Host: {}\r\n",
            host.unwrap_or(&format!("127.0.0.1:{port}"))
        ));
        if let Some(origin) = origin {
            head.push_str(&format!("Origin: {origin}\r\n"));
        }
        if let Some(content_type) = content_type {
            head.push_str(&format!("Content-Type: {content_type}\r\n"));
        }
        head.push_str(&format!("Content-Length: {}\r\n", body.len()));
        head.push_str("Connection: close\r\n\r\n");
        stream.write_all(head.as_bytes()).unwrap();
        stream.write_all(body).unwrap();
        stream.flush().unwrap();

        let mut raw = Vec::new();
        stream.read_to_end(&mut raw).unwrap();
        parse_response(&raw)
    }

    fn parse_response(raw: &[u8]) -> (u16, Vec<(String, String)>, Vec<u8>) {
        let split = raw
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .expect("response has a header terminator");
        let head = String::from_utf8_lossy(&raw[..split]).to_string();
        let body_start = split + 4;
        let body = raw[body_start..].to_vec();
        let mut lines = head.lines();
        let status_line = lines.next().unwrap();
        let status: u16 = status_line
            .split_whitespace()
            .nth(1)
            .unwrap()
            .parse()
            .unwrap();
        let headers = lines
            .filter_map(|line| line.split_once(':'))
            .map(|(name, value)| (name.trim().to_lowercase(), value.trim().to_string()))
            .collect();
        (status, headers, body)
    }

    fn token(session: &SigningSession) -> String {
        session
            .launch()
            .url
            .split("t=")
            .nth(1)
            .unwrap()
            .to_string()
    }

    #[test]
    fn session_serves_the_page_and_its_asset() {
        let session = open();
        let (status, headers, body) = request(
            &session,
            "GET",
            "/sign?t=",
            None,
            None,
            None,
            &[],
        );
        assert_eq!(status, 200);
        assert_eq!(
            headers
                .iter()
                .find(|(name, _)| name == "content-type")
                .map(|(_, value)| value.as_str()),
            Some("text/html; charset=utf-8")
        );
        assert!(String::from_utf8_lossy(&body).contains("bridge.js"));
        assert_eq!(
            headers
                .iter()
                .find(|(name, _)| name == "cache-control")
                .map(|(_, value)| value.as_str()),
            Some("no-store")
        );
        assert!(headers.iter().any(|(name, _)| name == "content-security-policy"));
        assert!(!headers
            .iter()
            .any(|(name, _)| name.starts_with("access-control")));

        let (asset_status, _, asset_body) =
            request(&session, "GET", "/assets/bridge.js", None, None, None, &[]);
        assert_eq!(asset_status, 200);
        assert!(String::from_utf8_lossy(&asset_body).contains("console.log"));
    }

    #[test]
    fn payload_endpoint_requires_the_token_and_returns_the_payload() {
        let session = open();
        let good = token(&session);

        let (status, _, _) = request(&session, "GET", "/sign/payload?t=wrong", None, None, None, &[]);
        assert_eq!(status, 403);

        let (status, headers, body) =
            request(&session, "GET", &format!("/sign/payload?t={good}"), None, None, None, &[]);
        assert_eq!(status, 200);
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["address"], OWNER);
        assert_eq!(json["xdr"], FIXTURE_XDR);
        assert_eq!(json["payloadHash"], "abc123");
        assert_eq!(json["summary"]["title"], "Sign a testnet payment");
        assert!(headers
            .iter()
            .any(|(name, _)| name == "referrer-policy"));
    }

    #[test]
    fn result_endpoint_accepts_one_signed_envelope_and_then_refuses_a_second() {
        let session = open();
        let token = token(&session);
        let signed = crate::bridge::verify::tests_support::sign_fixture(TEST_SIGNER_SEED);
        let body = serde_json::json!({
            "ok": true,
            "signedXdr": signed,
            "signerAddress": OWNER,
        })
        .to_string();

        let (status, _, _) = request(
            &session,
            "POST",
            &format!("/sign/result?t={token}"),
            None,
            None,
            Some("application/json"),
            body.as_bytes(),
        );
        assert_eq!(status, 204);

        let outcome = session.wait_for_result(Duration::from_secs(2)).unwrap();
        match outcome {
            SessionOutcome::Success(PageResult::Success { signed_xdr, .. }) => {
                assert_eq!(signed_xdr, signed);
            }
            other => panic!("unexpected outcome: {other:?}"),
        }

        // The token is one-time: a second result post is refused.
        let (status, _, _) = request(
            &session,
            "POST",
            &format!("/sign/result?t={token}"),
            None,
            None,
            Some("application/json"),
            body.as_bytes(),
        );
        assert_eq!(status, 410);
    }

    #[test]
    fn result_endpoint_refuses_wrong_token_host_origin_method_and_content_type() {
        let session = open();
        let token = token(&session);
        let body = br#"{"ok":false,"code":"rejected","error":"no"}"#;

        // Wrong token.
        let (status, _, _) = request(
            &session,
            "POST",
            "/sign/result?t=wrong",
            None,
            None,
            Some("application/json"),
            body,
        );
        assert_eq!(status, 403);

        // Wrong Host.
        let (status, _, _) = request(
            &session,
            "POST",
            &format!("/sign/result?t={token}"),
            Some("evil.example"),
            None,
            Some("application/json"),
            body,
        );
        assert_eq!(status, 403);

        // Foreign Origin.
        let (status, _, _) = request(
            &session,
            "POST",
            &format!("/sign/result?t={token}"),
            None,
            Some("http://evil.example"),
            Some("application/json"),
            body,
        );
        assert_eq!(status, 403);

        // Wrong content type.
        let (status, _, _) = request(
            &session,
            "POST",
            &format!("/sign/result?t={token}"),
            None,
            None,
            Some("text/plain"),
            body,
        );
        assert_eq!(status, 415);

        // Wrong method.
        let (status, _, _) = request(
            &session,
            "PUT",
            &format!("/sign/result?t={token}"),
            None,
            None,
            None,
            body,
        );
        assert_eq!(status, 404);

        // Nothing was accepted.
        assert!(session.wait_for_result(Duration::from_millis(100)).is_none());
    }

    #[test]
    fn result_endpoint_rejects_an_oversized_body() {
        let session = open();
        let token = token(&session);
        let big = vec![b'a'; MAX_BODY_BYTES + 1];
        let (status, _, _) = request(
            &session,
            "POST",
            &format!("/sign/result?t={token}"),
            None,
            None,
            Some("application/json"),
            &big,
        );
        assert_eq!(status, 413);
        assert!(session.wait_for_result(Duration::from_millis(100)).is_none());
    }

    #[test]
    fn payload_and_result_expire_after_the_ttl() {
        let session = SigningSession::start(
            payload(),
            Arc::new(FakeAssets),
            Duration::from_millis(1),
        )
        .unwrap();
        std::thread::sleep(Duration::from_millis(20));
        let token = token(&session);
        let (status, _, _) = request(&session, "GET", &format!("/sign/payload?t={token}"), None, None, None, &[]);
        assert_eq!(status, 410);
    }

    #[test]
    fn concurrent_second_session_has_its_own_token_and_port() {
        let first = open();
        let second = open();
        assert_ne!(first.launch().port, second.launch().port);
        assert_ne!(token(&first), token(&second));
        // The first session's token is unknown to the second.
        let (status, _, _) = request(
            &second,
            "GET",
            &format!("/sign/payload?t={}", token(&first)),
            None,
            None,
            None,
            &[],
        );
        assert_eq!(status, 403);
    }

    #[test]
    fn unknown_paths_are_not_found_and_no_path_traversal_is_served() {
        let session = open();
        let (status, _, _) = request(&session, "GET", "/../src-tauri/Cargo.toml", None, None, None, &[]);
        assert_eq!(status, 404);
        let (status, _, _) = request(&session, "GET", "/index.html", None, None, None, &[]);
        assert_eq!(status, 404);
    }

    #[test]
    fn missing_assets_answer_with_a_build_hint() {
        struct Empty;
        impl AssetProvider for Empty {
            fn get(&self, _path: &str) -> Option<ResolvedAsset> {
                None
            }
        }
        let session = SigningSession::start(
            payload(),
            Arc::new(Empty),
            Duration::from_secs(5),
        )
        .unwrap();
        let (status, _, body) = request(&session, "GET", "/sign?t=", None, None, None, &[]);
        assert_eq!(status, 404);
        assert!(String::from_utf8_lossy(&body).contains("npm run build -w @polaris/app"));
    }

    #[test]
    fn health_reports_fail_without_an_owner_and_ok_with_one() {
        let missing = health(&FakeAssets, None, Some("Google Chrome"));
        assert_eq!(missing.status, HealthStatus::Fail);
        assert!(!missing.detail.contains("Secret"));

        let bad = health(&FakeAssets, Some("not-an-address"), None);
        assert_eq!(bad.status, HealthStatus::Fail);

        let ok = health(&FakeAssets, Some(OWNER), Some("Google Chrome"));
        assert_eq!(ok.status, HealthStatus::Ok);
        assert_eq!(ok.id, HEALTH_ID);
        assert_eq!(ok.milestone, "W4b");
        assert!(ok.detail.contains("Google Chrome"));
        assert!(ok.checked_at > 0);
    }

    #[test]
    fn health_warns_when_the_page_is_unavailable() {
        struct Empty;
        impl AssetProvider for Empty {
            fn get(&self, _path: &str) -> Option<ResolvedAsset> {
                None
            }
        }
        let health = health(&Empty, Some(OWNER), None);
        assert_eq!(health.status, HealthStatus::Warn);
        assert!(health.detail.contains("npm run build"));
    }

    #[test]
    fn token_is_32_random_bytes_of_hex() {
        let first = random_token();
        let second = random_token();
        assert_eq!(first.len(), 64);
        assert!(first.bytes().all(|byte| byte.is_ascii_hexdigit()));
        assert_ne!(first, second);
    }

    #[test]
    fn percent_decode_and_query_token() {
        assert_eq!(percent_decode("a%2Fb"), "a/b");
        assert_eq!(percent_decode("%%2"), "%%2");
        assert_eq!(query_token("/sign?t=abc&x=1").as_deref(), Some("abc"));
        assert_eq!(query_token("/sign?x=1&t=abc").as_deref(), Some("abc"));
        assert_eq!(query_token("/sign?x=1"), None);
        assert_eq!(path_of("/sign/payload?t=abc"), "/sign/payload");
    }

    #[test]
    fn dir_asset_provider_refuses_traversal() {
        let root = crate::env::temp_dir("bridge-dir-assets");
        std::fs::write(root.join("bridge.html"), b"<html></html>").unwrap();
        let provider = DirAssetProvider::new(&root);
        assert!(provider.get("/sign").is_some());
        assert!(provider.get("/../Cargo.toml").is_none());
        assert!(provider.get("/..%2FCargo.toml").is_none());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn app_asset_provider_rejects_traversal_before_the_resolver() {
        use std::sync::atomic::{AtomicBool, Ordering};
        static CALLED: AtomicBool = AtomicBool::new(false);
        let provider = AppAssetProvider {
            inner: Box::new(|path: &str| {
                CALLED.store(true, Ordering::SeqCst);
                Some((path.as_bytes().to_vec(), "text/plain".to_string()))
            }),
        };
        assert!(provider.get("/../../app/src-tauri/Cargo.toml").is_none());
        assert!(
            !CALLED.load(Ordering::SeqCst),
            "the resolver must not be reached for a traversal path"
        );
        assert!(provider.get("/assets/bridge.js").is_some());
    }

    #[test]
    fn safe_asset_path_rejects_traversal_and_absolute_components() {
        assert!(is_safe_asset_path("/sign"));
        assert!(is_safe_asset_path("/assets/bridge.js"));
        assert!(!is_safe_asset_path(""));
        assert!(!is_safe_asset_path("relative"));
        assert!(!is_safe_asset_path("/../Cargo.toml"));
        assert!(!is_safe_asset_path("/..%2FCargo.toml"));
        assert!(!is_safe_asset_path("/foo/../../etc/passwd"));
        assert!(!is_safe_asset_path("//etc/passwd"));
        assert!(!is_safe_asset_path("/a\\b"));
    }

    #[test]
    fn read_body_distinguishes_an_oversized_body_from_a_read_error() {
        struct Failing;
        impl Read for Failing {
            fn read(&mut self, _buf: &mut [u8]) -> std::io::Result<usize> {
                Err(std::io::Error::other("boom"))
            }
        }

        let mut small: &[u8] = b"{}";
        assert_eq!(read_body(&mut small, 8).unwrap(), Some(b"{}".to_vec()));

        let mut big: &[u8] = &[b'a'; 9];
        assert_eq!(read_body(&mut big, 8).unwrap(), None);

        let mut failing = Failing;
        assert!(read_body(&mut failing, 8).is_err());
    }

    /// The seed used by the server test's envelope signature.
    const TEST_SIGNER_SEED: [u8; 32] = [7u8; 32];
}
