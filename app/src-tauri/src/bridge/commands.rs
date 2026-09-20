//! The three Tauri commands that expose the bridge (step W4b).
//!
//! `bridge_sign` is the only path by which an approved XDR reaches a wallet: it
//! calls the approval gate's [`ApprovalStore::take_authorized`] in process (the
//! gate's only exit), starts a one-shot session, opens the page and verifies the
//! result in Rust. `bridge_selftest` shares that machinery but never touches the
//! gate, so no approval is required — and it can only sign an envelope for the
//! configured owner with sequence number exactly `0`, which can never be applied
//! on-chain. `bridge_health` is the Debug panel's non-prompting check.
//!
//! Logging discipline: only outcome codes and the transaction hash are logged.
//! The one-time token, the unsigned XDR and the signed XDR never are.

use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, State};

use super::launch::{self, BrowserLauncher, SystemLauncher};
use super::server::{
    AppAssetProvider, AssetProvider, BridgePayload, PageResult, SessionOutcome, SigningSession,
    MAX_BODY_BYTES, SESSION_TTL,
};
use super::strkey;
use super::verify::{self, VerifyError};
use crate::approval::ApprovalStore;
use crate::stellar_config;

/// The Debug panel's "Test Freighter signing (no funds)" XDR. The self-test
/// deliberately also accepts an argument so a test can drive it offline.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeOutcome {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signed_xdr: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signer_address: Option<String>,
    /// The Stellar transaction hash (lowercase hex) Rust itself computed. This is
    /// what appears on stellar.expert.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tx_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl BridgeOutcome {
    fn ok(signed_xdr: String, signer_address: String, tx_hash: String) -> Self {
        Self {
            ok: true,
            signed_xdr: Some(signed_xdr),
            signer_address: Some(signer_address),
            tx_hash: Some(tx_hash),
            code: None,
            message: None,
        }
    }

    fn fail(code: &str, message: impl Into<String>) -> Self {
        Self {
            ok: false,
            signed_xdr: None,
            signer_address: None,
            tx_hash: None,
            code: Some(code.to_string()),
            message: Some(message.into()),
        }
    }

    fn integrity(error: VerifyError) -> Self {
        Self::fail("integrity", error.detail())
    }
}

/// Everything one signing run needs, resolved once and shared with the worker
/// closure. Keeping it a value (not `State`) is what lets a test run the whole
/// flow without a Tauri app.
struct RunContext {
    payload: BridgePayload,
    signer_key: [u8; 32],
    assets: Arc<dyn AssetProvider>,
    launcher: Arc<dyn BrowserLauncher>,
    browser: Option<String>,
}

/// Why a [`RunContext`] could not be built. [`BridgeOutcome`] is large, so it is
/// boxed here to keep the `Err` arm small.
type ContextResult = Result<RunContext, Box<BridgeOutcome>>;

impl RunContext {
    /// Assembles the payload for an authorized approval release: the bridge reads
    /// the owner address, passphrase, payload hash, summary and signature hint
    /// from the gate's record, and no XDR decoding is needed for the payload
    /// endpoint.
    fn from_authorized(
        released: crate::approval::AuthorizedPayload,
        config: &stellar_config::StellarConfig,
        owner: &str,
        assets: Arc<dyn AssetProvider>,
        launcher: Arc<dyn BrowserLauncher>,
        browser: Option<String>,
    ) -> ContextResult {
        let Some(signer_key) = strkey::decode_public_key(owner) else {
            return Err(Box::new(BridgeOutcome::fail(
                "address_mismatch",
                "the configured owner address is not a valid G... address",
            )));
        };
        if let Some(hint) = released.signer_hint.as_deref() {
            if hint != &signer_key[28..32] {
                return Err(Box::new(BridgeOutcome::fail(
                    "address_mismatch",
                    "the transaction source does not match the configured owner address",
                )));
            }
        }
        let payload = BridgePayload {
            xdr: released.unsigned_xdr,
            network_passphrase: config.network_passphrase.clone(),
            address: owner.to_string(),
            payload_hash: released.payload_hash,
            summary: released.summary,
        };
        Ok(Self {
            payload,
            signer_key,
            assets,
            launcher,
            browser,
        })
    }

    /// Runs the session: opens the browser, waits for the result and verifies.
    fn run(&self) -> BridgeOutcome {
        let session = match SigningSession::start(self.payload.clone(), Arc::clone(&self.assets), SESSION_TTL)
        {
            Ok(session) => session,
            Err(error) => {
                return BridgeOutcome::fail(
                    "error",
                    format!("could not start the signing session: {error}"),
                )
            }
        };
        let launch = session.launch().clone();
        if let Err(error) = self.launcher.open(&launch.url, self.browser.as_deref()) {
            session.shutdown();
            return BridgeOutcome::fail("error", error);
        }
        let outcome = session.wait_for_result(SESSION_TTL);
        session.shutdown();

        let Some(outcome) = outcome else {
            println!("polaris: bridge outcome=timeout");
            return BridgeOutcome::fail(
                "timeout",
                "the signing page did not return a result in time",
            );
        };
        self.finish(outcome)
    }

    /// Verifies what the page posted, independently of the page's own checks.
    fn finish(&self, outcome: SessionOutcome) -> BridgeOutcome {
        let SessionOutcome::Success(PageResult::Success {
            signed_xdr,
            signer_address,
        }) = outcome
        else {
            let (code, message) = match outcome {
                SessionOutcome::Failure { code, message } => (code, message),
                SessionOutcome::Success(_) => (
                    "error".to_string(),
                    "the signing page returned an unexpected result".to_string(),
                ),
            };
            println!("polaris: bridge outcome={code}");
            return BridgeOutcome::fail(&code, message);
        };

        if signer_address != self.payload.address {
            println!("polaris: bridge outcome=address_mismatch");
            return BridgeOutcome::fail(
                "address_mismatch",
                "the wallet signed with a different account than the owner address",
            );
        }

        match verify::verify_signed(
            &self.payload.xdr,
            &signed_xdr,
            &self.signer_key,
            &self.payload.network_passphrase,
        ) {
            Ok(hash) => {
                let tx_hash = hex::encode(hash);
                println!("polaris: bridge outcome=ok tx={tx_hash}");
                BridgeOutcome::ok(signed_xdr, signer_address, tx_hash)
            }
            Err(error) => {
                println!("polaris: bridge outcome=integrity");
                BridgeOutcome::integrity(error)
            }
        }
    }
}

/// The production asset provider: the app's embedded frontend assets.
///
/// In a dev build that did not bundle the frontend the resolver returns nothing;
/// [`DevFallbackAssets`] then reads `app/dist/*` next to the repository, so
/// `npm run tauri:dev` can try the bridge after `npm run build -w @polaris/app`.
/// When that is absent too, the server answers 404 with the build hint.
fn asset_provider(app: &AppHandle) -> Arc<dyn AssetProvider> {
    Arc::new(DevFallbackAssets {
        primary: AppAssetProvider::from_app_handle(app),
        dev_root: dev_dist_dir(),
    })
}

/// `app/dist` next to the repository root, derived from the crate's manifest dir
/// (`app/src-tauri`), so the fallback works regardless of the working directory.
fn dev_dist_dir() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|app| app.join("dist"))
        .unwrap_or_else(|| std::path::PathBuf::from("dist"))
}

/// Tries the embedded resolver first, then the on-disk dev build.
struct DevFallbackAssets {
    primary: AppAssetProvider,
    dev_root: std::path::PathBuf,
}

impl AssetProvider for DevFallbackAssets {
    fn get(&self, path: &str) -> Option<(Vec<u8>, String)> {
        self.primary.get(path).or_else(|| {
            let fallback = super::server::DirAssetProvider::new(self.dev_root.clone());
            fallback.get(path)
        })
    }
}

/// `bridge_sign(id)`: releases the authorized XDR for `id` and runs the bridge.
#[tauri::command]
pub async fn bridge_sign(
    app: AppHandle,
    store: State<'_, ApprovalStore>,
    launcher: State<'_, Arc<dyn BrowserLauncher>>,
    id: String,
) -> Result<BridgeOutcome, String> {
    let released = match store.take_authorized(&id) {
        Ok(payload) => payload,
        Err(error) => {
            return Ok(BridgeOutcome::fail("not_authorized", error.detail()));
        }
    };
    let config = stellar_config::read();
    let Some(owner) = config.owner_address.clone() else {
        return Ok(BridgeOutcome::fail(
            "address_mismatch",
            "no owner address is configured; set POLARIS_OWNER_ADDRESS",
        ));
    };
    let context = match RunContext::from_authorized(
        released,
        &config,
        &owner,
        asset_provider(&app),
        Arc::clone(launcher.inner()),
        launch::configured_browser(crate::env::var),
    ) {
        Ok(context) => context,
        Err(outcome) => return Ok(*outcome),
    };
    run_blocking(context).await
}

/// `bridge_selftest(xdr)`: the Debug panel's no-funds Freighter test.
///
/// It deliberately bypasses the approval gate, so it must be impossible to use it
/// to sign a real transaction: the envelope's source account has to be the
/// configured owner **and** its sequence number has to be exactly `0`. A
/// sequence-0 transaction can never be applied on-chain (a network rejects it as
/// a bad sequence), so the only thing the self-test can ever produce is a
/// signature over an unsubmittable transaction.
#[tauri::command]
pub async fn bridge_selftest(
    app: AppHandle,
    launcher: State<'_, Arc<dyn BrowserLauncher>>,
    xdr: String,
) -> Result<BridgeOutcome, String> {
    let config = stellar_config::read();
    let Some(owner) = config.owner_address.clone() else {
        return Ok(BridgeOutcome::fail(
            "address_mismatch",
            "no owner address is configured; set POLARIS_OWNER_ADDRESS",
        ));
    };
    // Validation first: the envelope must be safe to sign at all.
    let signer_key = match validate_selftest_xdr(&xdr, &owner)? {
        Ok(signer_key) => signer_key,
        Err(outcome) => return Ok(outcome),
    };

    let context = RunContext {
        payload: BridgePayload {
            xdr,
            network_passphrase: config.network_passphrase.clone(),
            address: owner.to_string(),
            payload_hash: crate::approval::payload_hash_of_xdr(""),
            summary: crate::types::TxSummary {
                title: "Freighter signing test (no funds)".to_string(),
                lines: vec![
                    "This transaction has sequence 0 and can never be submitted.".to_string(),
                ],
                explorer_url: None,
                estimated_fee: "0.0000100 XLM".to_string(),
            },
        },
        signer_key,
        assets: asset_provider(&app),
        launcher: Arc::clone(launcher.inner()),
        browser: launch::configured_browser(crate::env::var),
    };
    run_blocking(context).await
}

/// The self-test's hard safety rule: the envelope must belong to the configured
/// owner **and** have sequence number exactly `0`, so it can never be applied
/// on-chain. Returns the owner's key on success, or the refusal to hand back.
///
/// Split from the command so the rule is unit-testable without a Tauri app.
fn validate_selftest_xdr(
    xdr: &str,
    owner: &str,
) -> Result<Result<[u8; 32], BridgeOutcome>, String> {
    if xdr.len() > MAX_BODY_BYTES {
        return Ok(Err(BridgeOutcome::integrity(VerifyError::Truncated)));
    }
    let Some(signer_key) = strkey::decode_public_key(owner) else {
        return Ok(Err(BridgeOutcome::fail(
            "address_mismatch",
            "the configured owner address is not a valid G... address",
        )));
    };
    let bytes = match verify::decode_envelope(xdr) {
        Ok(bytes) => bytes,
        Err(error) => return Ok(Err(BridgeOutcome::integrity(error))),
    };
    let parsed = match verify::parse_unsigned(&bytes) {
        Ok(parsed) => parsed,
        Err(error) => return Ok(Err(BridgeOutcome::integrity(error))),
    };
    if parsed.source != signer_key {
        return Ok(Err(BridgeOutcome::fail(
            "address_mismatch",
            "the self-test transaction's source is not the configured owner address",
        )));
    }
    if parsed.sequence != 0 {
        return Ok(Err(BridgeOutcome::fail(
            "integrity",
            "the self-test transaction's sequence number is not 0, so it could be submitted",
        )));
    }
    Ok(Ok(signer_key))
}

/// `bridge_health()`: the non-prompting Debug check.
#[tauri::command]
pub fn bridge_health(app: AppHandle) -> crate::health::FeatureHealth {
    let config = stellar_config::read();
    super::server::health(
        asset_provider(&app).as_ref(),
        config.owner_address.as_deref(),
        launch::browser_for_health().as_deref(),
    )
}

/// Runs a [`RunContext`] on the blocking pool, so the Tauri async runtime is
/// never blocked by the session's 150 s wait.
async fn run_blocking(context: RunContext) -> Result<BridgeOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || context.run())
        .await
        .map_err(|error| format!("the bridge task did not finish: {error}"))
}

/// The launcher managed as state. Kept here so `lib.rs` has one line to add and
/// tests can install a fake.
pub fn system_launcher() -> Arc<dyn BrowserLauncher> {
    Arc::new(SystemLauncher)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bridge::server::{AssetProvider, DirAssetProvider};
    use ed25519_dalek::{Signer, SigningKey};
    use std::time::Duration;

    /// A real unsigned testnet payment owned by [`OWNER`], sequence 1.
    const FIXTURE_XDR: &str = crate::bridge::verify::tests_support::FIXTURE_XDR;
    const PASSPHRASE: &str = crate::bridge::verify::tests_support::PASSPHRASE;
    const OWNER: &str = "GAJW5V7VXHIRTJBGNVYTGXJ6CLDM7IEIPAYD3XLKKTKJKPRBYOTAC25A";
    const OWNER_KEY: [u8; 32] = crate::bridge::verify::tests_support::OWNER_KEY;

    struct FakeAssets;
    impl AssetProvider for FakeAssets {
        fn get(&self, path: &str) -> Option<(Vec<u8>, String)> {
            match path {
                "/sign" | "/sign/" => Some((
                    br#"<html><script type="module" src="/assets/bridge.js"></script></html>"#
                        .to_vec(),
                    "text/html; charset=utf-8".to_string(),
                )),
                "/assets/bridge.js" => {
                    Some((b"x".to_vec(), "text/javascript; charset=utf-8".to_string()))
                }
                _ => None,
            }
        }
    }

    fn payload(xdr: &str) -> BridgePayload {
        BridgePayload {
            xdr: xdr.to_string(),
            network_passphrase: PASSPHRASE.to_string(),
            address: OWNER.to_string(),
            payload_hash: "hash".to_string(),
            summary: crate::types::TxSummary {
                title: "Sign a testnet payment".to_string(),
                lines: vec!["Amount 1 XLM".to_string()],
                explorer_url: None,
                estimated_fee: "0.0000100 XLM".to_string(),
            },
        }
    }

    /// Signs `unsigned` by `seed` and returns `(signed_xdr, tx_hash)`.
    fn signed_by(unsigned: &str, seed: [u8; 32]) -> (String, String) {
        use base64::engine::general_purpose::STANDARD as BASE64;
        use base64::Engine as _;
        let key = SigningKey::from_bytes(&seed);
        let bytes = verify::decode_envelope(unsigned).unwrap();
        let parsed = verify::parse_unsigned(&bytes).unwrap();
        let hash = verify::tx_hash(parsed.body, PASSPHRASE);
        let signature = key.sign(&hash);
        let hint = &key.verifying_key().to_bytes()[28..32];
        let mut out = Vec::new();
        out.extend_from_slice(&bytes[..bytes.len() - 4]);
        out.extend_from_slice(&[0, 0, 0, 1]);
        out.extend_from_slice(hint);
        out.extend_from_slice(&[0, 0, 0, 64]);
        out.extend_from_slice(&signature.to_bytes());
        (BASE64.encode(out), hex::encode(hash))
    }

    /// A launcher that plays the page: when the bridge opens a URL it fetches the
    /// payload over real loopback, signs it with `seed` and posts the result
    /// back. This is the whole happy path with no browser and no Freighter.
    struct PageLauncher {
        seed: [u8; 32],
        tamper: bool,
    }

    impl BrowserLauncher for PageLauncher {
        fn open(&self, url: &str, _browser: Option<&str>) -> Result<(), String> {
            let port: u16 = url
                .trim_start_matches("http://127.0.0.1:")
                .split('/')
                .next()
                .unwrap()
                .parse()
                .unwrap();
            let token = url.split("t=").nth(1).unwrap().to_string();

            let payload = get_json(port, &format!("/sign/payload?t={token}"));
            let xdr = payload["xdr"].as_str().unwrap().to_string();
            let (mut signed, _) = signed_by(&xdr, self.seed);
            if self.tamper {
                // Flip a bit in the signature so Rust's independent check fails.
                use base64::engine::general_purpose::STANDARD as BASE64;
                use base64::Engine as _;
                let mut bytes = BASE64.decode(&signed).unwrap();
                let last = bytes.len() - 1;
                bytes[last] ^= 0x01;
                signed = BASE64.encode(bytes);
            }
            let body = serde_json::json!({
                "ok": true,
                "signedXdr": signed,
                "signerAddress": payload["address"].clone(),
            })
            .to_string();
            post_json(port, &format!("/sign/result?t={token}"), &body);
            Ok(())
        }
    }

    /// One blocking HTTP GET against the loopback session, parsed as JSON.
    fn get_json(port: u16, target: &str) -> serde_json::Value {
        use std::io::{Read as _, Write as _};
        use std::net::TcpStream;
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        stream
            .write_all(
                format!(
                    "GET {target} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
                )
                .as_bytes(),
            )
            .unwrap();
        let mut raw = Vec::new();
        stream.read_to_end(&mut raw).unwrap();
        let body_start = raw.windows(4).position(|w| w == b"\r\n\r\n").unwrap() + 4;
        serde_json::from_slice(&raw[body_start..]).unwrap()
    }

    /// One blocking HTTP POST with a JSON body.
    fn post_json(port: u16, target: &str, body: &str) -> u16 {
        use std::io::{Read as _, Write as _};
        use std::net::TcpStream;
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        stream
            .write_all(
                format!(
                    "POST {target} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                )
                .as_bytes(),
            )
            .unwrap();
        let mut raw = Vec::new();
        stream.read_to_end(&mut raw).unwrap();
        String::from_utf8_lossy(&raw)
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .and_then(|code| code.parse().ok())
            .unwrap()
    }

    /// A keypair whose public key is patched into the fixture, so the page can
    /// actually sign the transaction it is served.
    fn owned_fixture(seed: [u8; 32]) -> ([u8; 32], String) {
        let key = SigningKey::from_bytes(&seed);
        let public = key.verifying_key().to_bytes();
        let xdr = crate::bridge::verify::tests_support::fixture_with_source(public, 1);
        (public, xdr)
    }

    #[test]
    fn happy_path_verifies_a_locally_signed_envelope() {
        let seed = [3u8; 32];
        let (public, xdr) = owned_fixture(seed);
        let context = RunContext {
            payload: payload(&xdr),
            signer_key: public,
            assets: Arc::new(FakeAssets),
            launcher: Arc::new(PageLauncher { seed, tamper: false }),
            browser: None,
        };
        let expected_hash = {
            let bytes = verify::decode_envelope(&xdr).unwrap();
            let parsed = verify::parse_unsigned(&bytes).unwrap();
            hex::encode(verify::tx_hash(parsed.body, PASSPHRASE))
        };
        let outcome = context.run();
        assert!(outcome.ok, "expected ok, got {outcome:?}");
        assert_eq!(outcome.tx_hash.as_deref(), Some(expected_hash.as_str()));
        assert_eq!(outcome.signer_address.as_deref(), Some(OWNER));
        assert!(outcome.signed_xdr.is_some());
    }

    #[test]
    fn a_tampered_signature_is_integrity_not_ok() {
        let seed = [4u8; 32];
        let (public, xdr) = owned_fixture(seed);
        let context = RunContext {
            payload: payload(&xdr),
            signer_key: public,
            assets: Arc::new(FakeAssets),
            launcher: Arc::new(PageLauncher { seed, tamper: true }),
            browser: None,
        };
        let outcome = context.run();
        assert!(!outcome.ok);
        assert_eq!(outcome.code.as_deref(), Some("integrity"));
    }

    #[test]
    fn a_wrong_signer_is_integrity() {
        // The page signs with a different key than the payload's owner.
        let (_public, xdr) = owned_fixture([5u8; 32]);
        let owner_seed = [6u8; 32];
        let context = RunContext {
            payload: payload(&xdr),
            signer_key: SigningKey::from_bytes(&owner_seed).verifying_key().to_bytes(),
            assets: Arc::new(FakeAssets),
            launcher: Arc::new(PageLauncher {
                seed: [7u8; 32],
                tamper: false,
            }),
            browser: None,
        };
        let outcome = context.run();
        assert!(!outcome.ok);
        assert_eq!(outcome.code.as_deref(), Some("integrity"));
    }

    #[test]
    fn a_browser_launch_failure_is_an_error() {
        struct RefusingLauncher;
        impl BrowserLauncher for RefusingLauncher {
            fn open(&self, _url: &str, _browser: Option<&str>) -> Result<(), String> {
                Err("could not open the browser: boom".to_string())
            }
        }
        let context = RunContext {
            payload: payload(FIXTURE_XDR),
            signer_key: OWNER_KEY,
            assets: Arc::new(FakeAssets),
            launcher: Arc::new(RefusingLauncher),
            browser: None,
        };
        let outcome = context.run();
        assert!(!outcome.ok);
        assert_eq!(outcome.code.as_deref(), Some("error"));
    }

    #[test]
    fn selftest_accepts_only_an_owner_sequence_zero_envelope() {
        let owner_key = strkey::decode_public_key(OWNER).unwrap();
        // A sequence-0 envelope owned by the configured owner is the only input
        // the self-test may sign.
        let good = crate::bridge::verify::tests_support::fixture_with_source(owner_key, 0);
        let outcome = validate_selftest_xdr(&good, OWNER).unwrap();
        assert_eq!(outcome.unwrap(), owner_key);

        // The same envelope with sequence 1 could be submitted, so it is refused.
        let real = crate::bridge::verify::tests_support::fixture_with_source(owner_key, 1);
        let outcome = validate_selftest_xdr(&real, OWNER).unwrap().unwrap_err();
        assert_eq!(outcome.code.as_deref(), Some("integrity"));
        assert!(outcome.message.as_deref().unwrap().contains("sequence"));

        // A foreign source is refused even at sequence 0.
        let foreign = crate::bridge::verify::tests_support::fixture_with_source([0xCDu8; 32], 0);
        let outcome = validate_selftest_xdr(&foreign, OWNER).unwrap().unwrap_err();
        assert_eq!(outcome.code.as_deref(), Some("address_mismatch"));

        // A malformed envelope is `integrity`.
        let outcome = validate_selftest_xdr("not-base64 !!!", OWNER)
            .unwrap()
            .unwrap_err();
        assert_eq!(outcome.code.as_deref(), Some("integrity"));
    }

    #[test]
    fn run_context_rejects_a_body_that_does_not_match_the_owner() {
        let assets: Arc<dyn AssetProvider> = Arc::new(FakeAssets);
        let released = crate::approval::AuthorizedPayload {
            payload_hash: "hash".to_string(),
            unsigned_xdr: FIXTURE_XDR.to_string(),
            summary: crate::types::TxSummary {
                title: "t".to_string(),
                lines: vec![],
                explorer_url: None,
                estimated_fee: "0".to_string(),
            },
            intent: crate::types::Intent {
                kind: crate::types::IntentKind::Send,
                asset: "XLM".to_string(),
                amount: "1".to_string(),
                recipient: None,
                alias: None,
                memo: None,
                source: None,
            },
            signer_hint: Some(vec![0xAA; 4]),
        };
        let config = stellar_config::StellarConfig {
            network: "testnet".to_string(),
            rpc_url: "https://rpc".to_string(),
            horizon_url: "https://horizon".to_string(),
            network_passphrase: PASSPHRASE.to_string(),
            owner_address: Some(OWNER.to_string()),
            aliases: Default::default(),
            guard_contract_id: None,
            p2p_contract_id: None,
        };
        let outcome = RunContext::from_authorized(
            released,
            &config,
            OWNER,
            assets,
            Arc::new(PageLauncher {
                seed: OWNER_KEY,
                tamper: false,
            }),
            None,
        )
        .err()
        .expect("a mismatched hint must be refused");
        assert!(!outcome.ok);
        assert_eq!(outcome.code.as_deref(), Some("address_mismatch"));
    }

    #[test]
    fn the_gate_release_carries_a_matching_signer_hint() {
        // The only path by which XDR leaves the gate must hand the bridge a hint
        // it can compare against the configured owner before opening a browser.
        use crate::approval::{ApprovalMode, ApprovalRequest, ApprovalStore};
        use crate::biometric::{AuthError, Authenticator};

        struct Allow;
        impl Authenticator for Allow {
            fn authenticate(&self, _reason: &str) -> Result<(), AuthError> {
                Ok(())
            }
        }

        let (public, xdr) = owned_fixture([8u8; 32]);
        let store = ApprovalStore::new();
        let outcome = store
            .begin(ApprovalRequest {
                id: String::new(),
                payload_hash: crate::approval::payload_hash_of_xdr(&xdr),
                unsigned_xdr: xdr,
                summary: crate::types::TxSummary {
                    title: "t".to_string(),
                    lines: vec![],
                    explorer_url: None,
                    estimated_fee: "0".to_string(),
                },
                intent: crate::types::Intent {
                    kind: crate::types::IntentKind::Send,
                    asset: "XLM".to_string(),
                    amount: "1".to_string(),
                    recipient: None,
                    alias: None,
                    memo: None,
                    source: None,
                },
                mode: ApprovalMode::TouchId,
                origin: None,
            })
            .unwrap();
        store
            .authorize_with(&outcome.request.id, &Allow)
            .unwrap();
        let released = store.take_authorized(&outcome.request.id).unwrap();
        assert_eq!(released.signer_hint.as_deref(), Some(&public[28..32]));

        // The hint is additive and never carries the XDR to the webview: a second
        // release is impossible (single use).
        assert!(matches!(
            store.take_authorized(&outcome.request.id),
            Err(crate::approval::TakeError::NotAuthorized { .. })
        ));
    }

    #[test]
    fn bridge_outcome_serializes_camel_case() {
        let ok = BridgeOutcome::ok("xdr".to_string(), OWNER.to_string(), "ab".to_string());
        assert_eq!(
            serde_json::to_string(&ok).unwrap(),
            format!(
                r#"{{"ok":true,"signedXdr":"xdr","signerAddress":"{OWNER}","txHash":"ab"}}"#
            )
        );
        let fail = BridgeOutcome::fail("timeout", "too slow");
        assert_eq!(
            serde_json::to_string(&fail).unwrap(),
            r#"{"ok":false,"code":"timeout","message":"too slow"}"#
        );
        let integrity = BridgeOutcome::integrity(VerifyError::BodyMismatch);
        assert_eq!(integrity.code.as_deref(), Some("integrity"));
    }

    #[test]
    fn dir_provider_is_usable_off_disk() {
        let root = crate::env::temp_dir("bridge-commands-assets");
        std::fs::write(root.join("bridge.html"), b"<html></html>").unwrap();
        let provider = DirAssetProvider::new(&root);
        assert!(provider.get("/sign").is_some());
        std::fs::remove_dir_all(&root).unwrap();
    }
}
