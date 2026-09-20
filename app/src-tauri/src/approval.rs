//! The pending-approval store and the Touch ID gate (step W3).
//!
//! Every value-moving action needs a user approval before its unsigned XDR may
//! reach the Freighter bridge. Signing happens in the browser with the user's own
//! key; Polaris holds no secret material. The gate's whole job is therefore to
//! release **one specific unsigned XDR** after the device owner authenticates —
//! and to make that release unreachable any other way.
//!
//! ## One request at a time
//!
//! The store holds at most one entry. [`ApprovalStore::begin`] supersedes
//! whatever was there (the old request becomes `Denied` with the reason
//! `superseded`), so a stale approval can never be presented to the bridge after
//! the user has moved on.
//!
//! ## Hash binding
//!
//! `payloadHash` is the lowercase hex SHA-256 of the UTF-8 bytes of the base64
//! `unsignedXdr` string — a digest of the exact blob that will be released. It is
//! deliberately **not** the Stellar transaction hash (that needs XDR parsing and
//! a network passphrase); it is the same definition the agent uses
//! (`payloadHashOfXdr` in `agent/src/execution.ts`). `begin` rejects a request
//! whose hash does not match, so a compromised webview cannot get the gate to
//! authorize a different blob than the one it showed.
//!
//! ## Where XDR leaves
//!
//! [`ApprovalStore::take_authorized`] is the **only** path by which an unsigned
//! XDR leaves the gate. It is intentionally not a Tauri command; the bridge
//! server (another milestone) calls it in-process.

use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, State};

use crate::biometric::{AuthError, Authenticator};
use crate::events::{self, AgentStage, PolarisEvent};
use crate::health::now_ms;
use crate::types::{Intent, TxSummary};

/// How long a request stays actionable. At most one Touch ID prompt (60 s) plus
/// a moment to hand the payload to the bridge fits inside this.
pub const APPROVAL_TTL: Duration = Duration::from_secs(120);

/// Refuse unsigned XDR larger than this. A Stellar transaction envelope is a
/// couple of kilobytes at most; the cap keeps a hostile webview from parking a
/// huge blob in managed state.
pub const MAX_XDR_BYTES: usize = 16 * 1024;

/// The reason recorded when a `begin` replaces an outstanding request.
pub const SUPERSEDED_REASON: &str = "superseded";
/// The reason recorded when the user (or the panel) denies a request.
pub const DENIED_REASON: &str = "denied by user";

/// The `origin` value an anchor flow must carry to use `WalletOnly` mode. This is
/// a placeholder: see `TODO(W5)` on [`ApprovalStore::begin`].
pub const ANCHOR_ORIGIN: &str = "anchor";

/// Lowercase hex SHA-256 of the UTF-8 bytes of the base64 XDR string. This is
/// the binding the whole gate rests on; it matches `payloadHashOfXdr` (W1).
pub fn payload_hash_of_xdr(unsigned_xdr: &str) -> String {
    let digest = Sha256::digest(unsigned_xdr.as_bytes());
    hex::encode(digest)
}

/// How an approval is expected to be granted.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalMode {
    /// Touch ID (device password fallback) before release. The default.
    #[default]
    TouchId,
    /// No biometric prompt; reserved for anchor flows, where Freighter approves.
    WalletOnly,
}

/// The lifecycle of one request. `Consumed` is terminal and one-way.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalState {
    Pending,
    Authorized,
    Denied,
    Expired,
    Consumed,
}

impl ApprovalState {
    pub fn label(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Authorized => "authorized",
            Self::Denied => "denied",
            Self::Expired => "expired",
            Self::Consumed => "consumed",
        }
    }
}

/// A request to authorize the release of one unsigned XDR.
///
/// `id` is assigned by the gate, not the caller: a caller-chosen id would be a
/// way to confuse the bridge about which payload is which. It is `#[serde(default)]`
/// so the webview may omit it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRequest {
    #[serde(default)]
    pub id: String,
    pub payload_hash: String,
    pub unsigned_xdr: String,
    pub summary: TxSummary,
    pub intent: Intent,
    #[serde(default)]
    pub mode: ApprovalMode,
    /// Anchor-flow marker. Only meaningful (and only required) for `WalletOnly`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
}

/// What the approval panel may learn about the current request. It deliberately
/// **never** carries the unsigned XDR: that only leaves through
/// [`ApprovalStore::take_authorized`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalSnapshot {
    pub id: String,
    pub payload_hash: String,
    pub summary: TxSummary,
    pub intent: Intent,
    pub mode: ApprovalMode,
    pub state: ApprovalState,
    pub expires_at_ms: u64,
}

/// The state of one request, including why it was denied. Returned by
/// `approval_status`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalStatus {
    pub id: String,
    pub state: ApprovalState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// The one payload the gate releases. Produced only by `take_authorized`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorizedPayload {
    pub payload_hash: String,
    pub unsigned_xdr: String,
    pub summary: TxSummary,
    pub intent: Intent,
}

/// Why a request could not be created.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BeginError {
    EmptyXdr,
    OversizedXdr { bytes: usize, max: usize },
    HashMismatch,
    WalletOnlyNotAllowed,
}

/// Why an authorization could not be completed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthorizeError {
    NotFound,
    NotPending { state: ApprovalState },
    Expired,
    Busy,
}

/// Why a denial could not be recorded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DenyError {
    NotFound,
    NotPending { state: ApprovalState },
    Expired,
}

/// Why the authorized payload could not be taken.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TakeError {
    NotFound,
    NotAuthorized { state: ApprovalState },
    Expired,
}

impl BeginError {
    pub fn label(&self) -> &'static str {
        match self {
            Self::EmptyXdr => "Empty XDR",
            Self::OversizedXdr { .. } => "XDR too large",
            Self::HashMismatch => "Bad hash",
            Self::WalletOnlyNotAllowed => "Wallet only",
        }
    }

    pub fn detail(&self) -> String {
        match self {
            Self::EmptyXdr => "the approval request carried no unsigned XDR".to_string(),
            Self::OversizedXdr { bytes, max } => {
                format!("the unsigned XDR is {bytes} bytes; the cap is {max}")
            }
            Self::HashMismatch => "the payload hash does not match the unsigned XDR".to_string(),
            Self::WalletOnlyNotAllowed => {
                "wallet-only approval is reserved for anchor flows (origin \"anchor\")".to_string()
            }
        }
    }
}

impl AuthorizeError {
    pub fn label(&self) -> &'static str {
        match self {
            Self::NotFound => "No request",
            Self::NotPending { .. } => "Not pending",
            Self::Expired => "Expired",
            Self::Busy => "In progress",
        }
    }

    pub fn detail(&self) -> String {
        match self {
            Self::NotFound => "there is no approval request with that id".to_string(),
            Self::NotPending { state } => {
                format!(
                    "the approval request is {} and cannot be authorized",
                    state.label()
                )
            }
            Self::Expired => "the approval request expired before it was authorized".to_string(),
            Self::Busy => "an approval prompt is already open for this request".to_string(),
        }
    }
}

impl DenyError {
    pub fn label(&self) -> &'static str {
        match self {
            Self::NotFound => "No request",
            Self::NotPending { .. } => "Not pending",
            Self::Expired => "Expired",
        }
    }

    pub fn detail(&self) -> String {
        match self {
            Self::NotFound => "there is no approval request with that id".to_string(),
            Self::NotPending { state } => {
                format!(
                    "the approval request is {} and cannot be denied",
                    state.label()
                )
            }
            Self::Expired => "the approval request expired before it was denied".to_string(),
        }
    }
}

#[allow(dead_code)] // Surfaced by the Freighter bridge server (W4).
impl TakeError {
    pub fn label(&self) -> &'static str {
        match self {
            Self::NotFound => "No request",
            Self::NotAuthorized { .. } => "Not authorized",
            Self::Expired => "Expired",
        }
    }

    pub fn detail(&self) -> String {
        match self {
            Self::NotFound => "there is no approval request with that id".to_string(),
            Self::NotAuthorized { state } => {
                format!(
                    "the approval request is {} and cannot be released",
                    state.label()
                )
            }
            Self::Expired => "the approval request expired before it was released".to_string(),
        }
    }
}

/// The prior request a `begin` displaced.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SupersededRequest {
    pub payload_hash: String,
    pub reason: &'static str,
}

/// The outcome of `begin`: the stored request (with its assigned id) and the
/// request it superseded, if any.
#[derive(Debug, Clone, PartialEq)]
pub struct BeginOutcome {
    pub request: ApprovalRequest,
    pub superseded: Option<SupersededRequest>,
}

/// The result of preparing a Touch ID prompt.
#[derive(Debug, Clone, PartialEq, Eq)]
struct AuthorizePlan {
    mode: ApprovalMode,
    reason: String,
}

struct Entry {
    request: ApprovalRequest,
    state: ApprovalState,
    expires_at: Instant,
    /// True while a biometric prompt is being shown, so a second caller cannot
    /// open a second prompt for the same request.
    in_flight: bool,
    reason: Option<String>,
}

struct StoreInner {
    next_id: u64,
    current: Option<Entry>,
}

/// The managed pending-approval store. Cheap to clone; all clones share state.
#[derive(Clone)]
pub struct ApprovalStore {
    inner: Arc<Mutex<StoreInner>>,
    now: Arc<dyn Fn() -> Instant + Send + Sync>,
    base: Instant,
    base_epoch_ms: u64,
}

impl ApprovalStore {
    pub fn new() -> Self {
        Self::with_clock(Arc::new(Instant::now))
    }

    /// Builds a store on an injected clock. Only tests need this; production
    /// uses [`ApprovalStore::new`].
    pub fn with_clock(now: Arc<dyn Fn() -> Instant + Send + Sync>) -> Self {
        let base = now();
        Self {
            inner: Arc::new(Mutex::new(StoreInner {
                next_id: 0,
                current: None,
            })),
            now,
            base,
            base_epoch_ms: now_ms(),
        }
    }

    fn now(&self) -> Instant {
        (self.now)()
    }

    fn lock(&self) -> MutexGuard<'_, StoreInner> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Converts a monotonic instant to wall-clock milliseconds for the webview.
    fn epoch_ms_of(&self, at: Instant) -> u64 {
        let delta = at.saturating_duration_since(self.base).as_millis() as u64;
        self.base_epoch_ms.saturating_add(delta)
    }

    /// Registers a new pending request, superseding the previous one.
    ///
    /// Validation is fail-closed: an empty or oversized XDR, a hash that does not
    /// match it, or a `WalletOnly` request without the anchor marker is rejected
    /// and nothing is stored. On success the previous request (if it was still
    /// `Pending` or `Authorized`) becomes `Denied` with
    /// [`SUPERSEDED_REASON`], and its payload hash is returned so the caller can
    /// emit the matching `approval_result`.
    ///
    // TODO(W5): the `origin: "anchor"` check is a placeholder — the webview can
    // forge that string. The anchor milestone must bind wallet-only mode to a
    // Rust-verifiable signal (e.g. a SEP-10 challenge with sequence number 0)
    // instead of trusting a caller-supplied field.
    pub fn begin(&self, mut request: ApprovalRequest) -> Result<BeginOutcome, BeginError> {
        if request.unsigned_xdr.is_empty() {
            return Err(BeginError::EmptyXdr);
        }
        let bytes = request.unsigned_xdr.len();
        if bytes > MAX_XDR_BYTES {
            return Err(BeginError::OversizedXdr {
                bytes,
                max: MAX_XDR_BYTES,
            });
        }
        if request.payload_hash != payload_hash_of_xdr(&request.unsigned_xdr) {
            return Err(BeginError::HashMismatch);
        }
        if request.mode == ApprovalMode::WalletOnly
            && request.origin.as_deref() != Some(ANCHOR_ORIGIN)
        {
            return Err(BeginError::WalletOnlyNotAllowed);
        }

        let now = self.now();
        let mut inner = self.lock();
        inner.next_id += 1;
        request.id = format!("apr_{:016x}", inner.next_id);

        // The old entry is replaced, not kept: the store holds exactly one
        // request. Its `Denied`/`superseded` outcome survives only as the
        // `approval_result` the command emits with the returned hash.
        let superseded = match inner.current.take() {
            Some(old)
                if matches!(
                    old.state,
                    ApprovalState::Pending | ApprovalState::Authorized
                ) =>
            {
                Some(SupersededRequest {
                    payload_hash: old.request.payload_hash,
                    reason: SUPERSEDED_REASON,
                })
            }
            _ => None,
        };
        inner.current = Some(Entry {
            request: request.clone(),
            state: ApprovalState::Pending,
            expires_at: now + APPROVAL_TTL,
            in_flight: false,
            reason: None,
        });

        Ok(BeginOutcome {
            request,
            superseded,
        })
    }

    /// Locks in a fresh `authorize_with` and returns the plan for the prompt.
    fn prepare_authorize(&self, id: &str) -> Result<AuthorizePlan, AuthorizeError> {
        let now = self.now();
        let mut inner = self.lock();
        let entry = inner.current.as_mut().ok_or(AuthorizeError::NotFound)?;
        if entry.request.id != id {
            return Err(AuthorizeError::NotFound);
        }
        if entry.state != ApprovalState::Pending {
            return Err(AuthorizeError::NotPending { state: entry.state });
        }
        if now >= entry.expires_at {
            entry.state = ApprovalState::Expired;
            return Err(AuthorizeError::Expired);
        }
        if entry.in_flight {
            return Err(AuthorizeError::Busy);
        }
        entry.in_flight = true;
        Ok(AuthorizePlan {
            mode: entry.request.mode,
            reason: format!("Approve {}", entry.request.summary.title),
        })
    }

    /// Records the decision for a prepared request. `approved == false` releases
    /// the in-flight latch but leaves the request `Pending` so the user may
    /// retry or deny it explicitly.
    fn finish_authorize(
        &self,
        id: &str,
        approved: bool,
    ) -> Result<AuthorizedPayload, AuthorizeError> {
        let now = self.now();
        let mut inner = self.lock();
        let entry = inner.current.as_mut().ok_or(AuthorizeError::NotFound)?;
        if entry.request.id != id {
            return Err(AuthorizeError::NotFound);
        }
        if entry.state == ApprovalState::Expired || now >= entry.expires_at {
            entry.state = ApprovalState::Expired;
            entry.in_flight = false;
            return Err(AuthorizeError::Expired);
        }
        if entry.state != ApprovalState::Pending {
            entry.in_flight = false;
            return Err(AuthorizeError::NotPending { state: entry.state });
        }
        entry.in_flight = false;
        if approved {
            entry.state = ApprovalState::Authorized;
        }
        Ok(AuthorizedPayload {
            payload_hash: entry.request.payload_hash.clone(),
            unsigned_xdr: entry.request.unsigned_xdr.clone(),
            summary: entry.request.summary.clone(),
            intent: entry.request.intent.clone(),
        })
    }

    /// Runs the approval flow for `id` and returns the payload hash on success.
    ///
    /// Split from the Tauri command on purpose: the whole flow (plan → prompt →
    /// record) is `&self` and takes the authenticator as an argument, so a fake
    /// authenticator can drive every branch in a unit test without a window.
    /// Blocking — the caller runs it on the blocking pool.
    pub fn authorize_with(
        &self,
        id: &str,
        authenticator: &dyn Authenticator,
    ) -> Result<String, AuthorizeFailure> {
        let plan = self.prepare_authorize(id)?;
        let approved = match plan.mode {
            ApprovalMode::WalletOnly => true,
            ApprovalMode::TouchId => match authenticator.authenticate(&plan.reason) {
                Ok(()) => true,
                Err(error) => {
                    // Keep the request Pending: a cancelled prompt is not a
                    // decision, and the panel can retry or deny explicitly.
                    let _ = self.finish_authorize(id, false);
                    return Err(AuthorizeFailure::Auth(error));
                }
            },
        };
        let payload = self.finish_authorize(id, approved)?;
        Ok(payload.payload_hash)
    }

    /// Marks a pending request denied and returns its payload hash.
    pub fn deny(&self, id: &str) -> Result<String, DenyError> {
        let now = self.now();
        let mut inner = self.lock();
        let entry = inner.current.as_mut().ok_or(DenyError::NotFound)?;
        if entry.request.id != id {
            return Err(DenyError::NotFound);
        }
        if entry.state == ApprovalState::Expired || now >= entry.expires_at {
            entry.state = ApprovalState::Expired;
            return Err(DenyError::Expired);
        }
        if entry.state != ApprovalState::Pending {
            return Err(DenyError::NotPending { state: entry.state });
        }
        entry.state = ApprovalState::Denied;
        entry.in_flight = false;
        entry.reason = Some(DENIED_REASON.to_string());
        Ok(entry.request.payload_hash.clone())
    }

    /// The current state of one request, or `None` if the id is unknown.
    pub fn status(&self, id: &str) -> Option<ApprovalStatus> {
        let now = self.now();
        let mut inner = self.lock();
        let entry = inner.current.as_mut()?;
        if entry.request.id != id {
            return None;
        }
        if entry.state == ApprovalState::Expired
            || (matches!(
                entry.state,
                ApprovalState::Pending | ApprovalState::Authorized
            ) && now >= entry.expires_at)
        {
            entry.state = ApprovalState::Expired;
        }
        Some(ApprovalStatus {
            id: entry.request.id.clone(),
            state: entry.state,
            reason: entry.reason.clone(),
        })
    }

    /// The snapshot the panel hydrates from, or `None` when there is nothing
    /// pending or authorized. Never includes the unsigned XDR.
    pub fn current(&self) -> Option<ApprovalSnapshot> {
        let now = self.now();
        let mut inner = self.lock();
        let entry = inner.current.as_mut()?;
        if entry.state == ApprovalState::Expired
            || (matches!(
                entry.state,
                ApprovalState::Pending | ApprovalState::Authorized
            ) && now >= entry.expires_at)
        {
            entry.state = ApprovalState::Expired;
            return None;
        }
        if !matches!(
            entry.state,
            ApprovalState::Pending | ApprovalState::Authorized
        ) {
            return None;
        }
        Some(ApprovalSnapshot {
            id: entry.request.id.clone(),
            payload_hash: entry.request.payload_hash.clone(),
            summary: entry.request.summary.clone(),
            intent: entry.request.intent.clone(),
            mode: entry.request.mode,
            state: entry.state,
            expires_at_ms: self.epoch_ms_of(entry.expires_at),
        })
    }

    /// Releases the unsigned XDR, **once**.
    ///
    /// This is the only path by which XDR leaves the gate. It returns the payload
    /// only while the request is `Authorized` and unexpired, and marks it
    /// `Consumed` so a second call fails. The bridge server (another milestone)
    /// calls this in-process; it is deliberately not a Tauri command.
    #[allow(dead_code)] // Called by the Freighter bridge server (W4).
    pub(crate) fn take_authorized(&self, id: &str) -> Result<AuthorizedPayload, TakeError> {
        let now = self.now();
        let mut inner = self.lock();
        let entry = inner.current.as_mut().ok_or(TakeError::NotFound)?;
        if entry.request.id != id {
            return Err(TakeError::NotFound);
        }
        if entry.state == ApprovalState::Expired || now >= entry.expires_at {
            entry.state = ApprovalState::Expired;
            return Err(TakeError::Expired);
        }
        if entry.state != ApprovalState::Authorized {
            return Err(TakeError::NotAuthorized { state: entry.state });
        }
        entry.state = ApprovalState::Consumed;
        Ok(AuthorizedPayload {
            payload_hash: entry.request.payload_hash.clone(),
            unsigned_xdr: entry.request.unsigned_xdr.clone(),
            summary: entry.request.summary.clone(),
            intent: entry.request.intent.clone(),
        })
    }
}

impl Default for ApprovalStore {
    fn default() -> Self {
        Self::new()
    }
}

/// The command-level failure shape, mirroring `SpeechFailure`: a short UI label
/// plus the full terminal detail.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalFailure {
    pub label: String,
    pub detail: String,
}

impl From<BeginError> for ApprovalFailure {
    fn from(error: BeginError) -> Self {
        Self {
            label: error.label().to_string(),
            detail: error.detail(),
        }
    }
}

impl From<DenyError> for ApprovalFailure {
    fn from(error: DenyError) -> Self {
        Self {
            label: error.label().to_string(),
            detail: error.detail(),
        }
    }
}

impl From<AuthError> for ApprovalFailure {
    fn from(error: AuthError) -> Self {
        Self {
            label: error.label().to_string(),
            detail: error.detail(),
        }
    }
}

/// An authorize step can fail in the store or at the prompt; both map to the
/// same command-level shape.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthorizeFailure {
    Store(AuthorizeError),
    Auth(AuthError),
}

impl From<AuthorizeError> for AuthorizeFailure {
    fn from(error: AuthorizeError) -> Self {
        Self::Store(error)
    }
}

impl From<AuthorizeFailure> for ApprovalFailure {
    fn from(error: AuthorizeFailure) -> Self {
        match error {
            AuthorizeFailure::Store(error) => Self {
                label: error.label().to_string(),
                detail: error.detail(),
            },
            AuthorizeFailure::Auth(error) => error.into(),
        }
    }
}

/// Registers a request and announces it. Superseding the previous request emits
/// the matching `approval_result` so a waiter on the old payload learns it is
/// dead.
#[tauri::command]
pub fn approval_begin(
    app: AppHandle,
    store: State<'_, ApprovalStore>,
    request: ApprovalRequest,
) -> Result<String, ApprovalFailure> {
    let outcome = store.begin(request)?;
    if let Some(superseded) = &outcome.superseded {
        events::emit(
            &app,
            PolarisEvent::ApprovalResult {
                payload_hash: superseded.payload_hash.clone(),
                approved: false,
            },
        );
    }
    events::emit(
        &app,
        PolarisEvent::ApprovalRequest {
            intent: outcome.request.intent.clone(),
            summary: outcome.request.summary.clone(),
            payload_hash: outcome.request.payload_hash.clone(),
        },
    );
    events::emit(
        &app,
        PolarisEvent::AgentStatus {
            stage: AgentStage::AwaitingApproval,
        },
    );
    Ok(outcome.request.id)
}

/// Authenticates and, on success, authorizes the request. Runs the prompt on the
/// blocking pool so the Tauri async runtime is never blocked.
#[tauri::command]
pub async fn approval_authorize(
    app: AppHandle,
    store: State<'_, ApprovalStore>,
    authenticator: State<'_, Arc<dyn Authenticator>>,
    id: String,
) -> Result<(), ApprovalFailure> {
    let store = store.inner().clone();
    let authenticator = Arc::clone(authenticator.inner());
    let task_id = id.clone();
    let joined = tauri::async_runtime::spawn_blocking(move || {
        store.authorize_with(&task_id, authenticator.as_ref())
    })
    .await;

    match joined {
        Ok(Ok(payload_hash)) => {
            events::emit(
                &app,
                PolarisEvent::ApprovalResult {
                    payload_hash,
                    approved: true,
                },
            );
            Ok(())
        }
        Ok(Err(failure)) => Err(failure.into()),
        Err(error) => Err(ApprovalFailure {
            label: "Auth failed".to_string(),
            detail: format!("the approval task did not finish: {error}"),
        }),
    }
}

/// Denies a pending request (an explicit user decision).
#[tauri::command]
pub fn approval_deny(
    app: AppHandle,
    store: State<'_, ApprovalStore>,
    id: String,
) -> Result<(), ApprovalFailure> {
    let payload_hash = store.deny(&id)?;
    events::emit(
        &app,
        PolarisEvent::ApprovalResult {
            payload_hash,
            approved: false,
        },
    );
    Ok(())
}

/// The state of one request, for a panel that already has an id.
#[tauri::command]
pub fn approval_status(store: State<'_, ApprovalStore>, id: String) -> Option<ApprovalStatus> {
    store.status(&id)
}

/// Hydrates a panel that opened *after* the `approval_request` event fired.
#[tauri::command]
pub fn approval_current(store: State<'_, ApprovalStore>) -> Option<ApprovalSnapshot> {
    store.current()
}

#[cfg(test)]
mod tests {
    use super::*;

    const XDR_ABC: &str = "abc";
    const XDR_ABC_HASH: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    // A realistic unsigned base64 envelope (Stellar transaction, testnet).
    const XDR_REAL: &str = "AAAAAgAAAADNl0uMf6c8Q2sT5xY1bV3wR9pE7kH4mJ0nG2dF8aC6oAAAAAAAAAABAAAAAAAAAAEAAAAAAAAAAQAAAAEAAAAA";
    const XDR_REAL_HASH: &str = "68e7a642b25f89684fa7d522c9e1da5eeb1d8fce12cdc3f79de7e9d98d020fd4";

    struct ManualClock {
        now: Arc<Mutex<Instant>>,
    }

    impl ManualClock {
        fn new() -> Self {
            Self {
                now: Arc::new(Mutex::new(Instant::now())),
            }
        }

        fn handle(&self) -> Arc<dyn Fn() -> Instant + Send + Sync> {
            let now = Arc::clone(&self.now);
            Arc::new(move || *now.lock().unwrap())
        }

        fn advance(&self, delta: Duration) {
            *self.now.lock().unwrap() += delta;
        }
    }

    struct FakeAuth {
        result: Result<(), AuthError>,
        calls: Mutex<usize>,
    }

    impl FakeAuth {
        fn ok() -> Self {
            Self {
                result: Ok(()),
                calls: Mutex::new(0),
            }
        }

        fn err(error: AuthError) -> Self {
            Self {
                result: Err(error),
                calls: Mutex::new(0),
            }
        }
    }

    impl Authenticator for FakeAuth {
        fn authenticate(&self, _reason: &str) -> Result<(), AuthError> {
            *self.calls.lock().unwrap() += 1;
            self.result.clone()
        }
    }

    fn summary() -> TxSummary {
        TxSummary {
            title: "Send 10 XLM".into(),
            lines: vec!["to acc2".into()],
            explorer_url: None,
            estimated_fee: "0.00001 XLM".into(),
        }
    }

    fn intent() -> Intent {
        Intent {
            kind: crate::types::IntentKind::Send,
            asset: "XLM".into(),
            amount: "10".into(),
            recipient: Some("acc2".into()),
            alias: None,
            memo: None,
            source: None,
        }
    }

    fn request(xdr: &str) -> ApprovalRequest {
        ApprovalRequest {
            id: String::new(),
            payload_hash: payload_hash_of_xdr(xdr),
            unsigned_xdr: xdr.to_string(),
            summary: summary(),
            intent: intent(),
            mode: ApprovalMode::TouchId,
            origin: None,
        }
    }

    #[test]
    fn payload_hash_matches_the_known_sha256_vector() {
        assert_eq!(payload_hash_of_xdr(XDR_ABC), XDR_ABC_HASH);
        assert_eq!(payload_hash_of_xdr(XDR_REAL), XDR_REAL_HASH);
        assert_eq!(payload_hash_of_xdr(XDR_ABC).len(), 64);
    }

    #[test]
    fn begin_rejects_an_empty_xdr() {
        let store = ApprovalStore::new();
        let mut req = request(XDR_ABC);
        req.unsigned_xdr.clear();
        assert_eq!(store.begin(req), Err(BeginError::EmptyXdr));
    }

    #[test]
    fn begin_rejects_a_mismatched_hash() {
        let store = ApprovalStore::new();
        let mut req = request(XDR_ABC);
        req.payload_hash = XDR_REAL_HASH.to_string();
        assert_eq!(store.begin(req), Err(BeginError::HashMismatch));
    }

    #[test]
    fn begin_rejects_an_oversized_payload() {
        let store = ApprovalStore::new();
        let huge = "A".repeat(MAX_XDR_BYTES + 1);
        let req = request(&huge);
        assert_eq!(
            store.begin(req),
            Err(BeginError::OversizedXdr {
                bytes: MAX_XDR_BYTES + 1,
                max: MAX_XDR_BYTES
            })
        );
    }

    #[test]
    fn begin_rejects_wallet_only_without_the_anchor_marker() {
        let store = ApprovalStore::new();
        let mut req = request(XDR_ABC);
        req.mode = ApprovalMode::WalletOnly;
        assert_eq!(store.begin(req), Err(BeginError::WalletOnlyNotAllowed));
    }

    #[test]
    fn begin_accepts_wallet_only_with_the_anchor_marker() {
        let store = ApprovalStore::new();
        let mut req = request(XDR_ABC);
        req.mode = ApprovalMode::WalletOnly;
        req.origin = Some(ANCHOR_ORIGIN.to_string());
        assert!(store.begin(req).is_ok());
    }

    #[test]
    fn unknown_mode_is_rejected_by_deserialization() {
        let json = format!(
            r#"{{"payloadHash":"{XDR_ABC_HASH}","unsignedXdr":"{XDR_ABC}","summary":{{"title":"t","lines":[],"estimatedFee":"0"}},"intent":{{"kind":"send","asset":"XLM","amount":"1"}},"mode":"magic"}}"#
        );
        assert!(serde_json::from_str::<ApprovalRequest>(&json).is_err());
    }

    #[test]
    fn begin_assigns_an_id_and_supersedes_the_old_request() {
        let store = ApprovalStore::new();
        let first = store.begin(request(XDR_ABC)).unwrap();
        assert!(first.request.id.starts_with("apr_"));
        assert!(first.superseded.is_none());

        let second = store.begin(request(XDR_REAL)).unwrap();
        assert_ne!(first.request.id, second.request.id);
        let superseded = second.superseded.as_ref().unwrap();
        assert_eq!(superseded.payload_hash, XDR_ABC_HASH);
        assert_eq!(superseded.reason, SUPERSEDED_REASON);

        // The superseded request is gone from the store (one entry only); the
        // caller learns about it from the returned hash / emitted result.
        assert!(store.status(&first.request.id).is_none());
        let new = store.status(&second.request.id).unwrap();
        assert_eq!(new.state, ApprovalState::Pending);
    }

    #[test]
    fn touch_id_happy_path_authorizes_and_emits_the_hash() {
        let store = ApprovalStore::new();
        let outcome = store.begin(request(XDR_ABC)).unwrap();
        let auth = FakeAuth::ok();
        let payload_hash = store.authorize_with(&outcome.request.id, &auth).unwrap();
        assert_eq!(payload_hash, XDR_ABC_HASH);
        assert_eq!(*auth.calls.lock().unwrap(), 1);
        assert_eq!(
            store.status(&outcome.request.id).unwrap().state,
            ApprovalState::Authorized
        );
    }

    #[test]
    fn a_cancelled_prompt_leaves_the_request_pending() {
        let store = ApprovalStore::new();
        let outcome = store.begin(request(XDR_ABC)).unwrap();
        let auth = FakeAuth::err(AuthError::Cancelled);
        assert_eq!(
            store.authorize_with(&outcome.request.id, &auth),
            Err(AuthorizeFailure::Auth(AuthError::Cancelled))
        );
        assert_eq!(
            store.status(&outcome.request.id).unwrap().state,
            ApprovalState::Pending
        );
    }

    #[test]
    fn a_failed_prompt_keeps_the_request_pending() {
        let store = ApprovalStore::new();
        let outcome = store.begin(request(XDR_ABC)).unwrap();
        let auth = FakeAuth::err(AuthError::Failed("nope".into()));
        assert!(store.authorize_with(&outcome.request.id, &auth).is_err());
        assert_eq!(
            store.status(&outcome.request.id).unwrap().state,
            ApprovalState::Pending
        );
    }

    #[test]
    fn a_timed_out_prompt_keeps_the_request_pending() {
        let store = ApprovalStore::new();
        let outcome = store.begin(request(XDR_ABC)).unwrap();
        let auth = FakeAuth::err(AuthError::Timeout);
        assert!(store.authorize_with(&outcome.request.id, &auth).is_err());
        assert_eq!(
            store.status(&outcome.request.id).unwrap().state,
            ApprovalState::Pending
        );
    }

    #[test]
    fn a_wallet_only_request_never_prompts() {
        let store = ApprovalStore::new();
        let mut req = request(XDR_ABC);
        req.mode = ApprovalMode::WalletOnly;
        req.origin = Some(ANCHOR_ORIGIN.to_string());
        let outcome = store.begin(req).unwrap();
        let auth = FakeAuth::err(AuthError::Failed("must not be called".into()));
        let payload_hash = store.authorize_with(&outcome.request.id, &auth).unwrap();
        assert_eq!(payload_hash, XDR_ABC_HASH);
        assert_eq!(*auth.calls.lock().unwrap(), 0);
    }

    #[test]
    fn ttl_expiry_denies_authorization_and_release() {
        let clock = ManualClock::new();
        let store = ApprovalStore::with_clock(clock.handle());
        let outcome = store.begin(request(XDR_ABC)).unwrap();
        clock.advance(APPROVAL_TTL + Duration::from_secs(1));

        let auth = FakeAuth::ok();
        assert_eq!(
            store.authorize_with(&outcome.request.id, &auth),
            Err(AuthorizeFailure::Store(AuthorizeError::Expired))
        );
        assert_eq!(*auth.calls.lock().unwrap(), 0);
        assert_eq!(
            store.status(&outcome.request.id).unwrap().state,
            ApprovalState::Expired
        );
        assert!(store.current().is_none());
        assert_eq!(
            store.take_authorized(&outcome.request.id),
            Err(TakeError::Expired)
        );
    }

    #[test]
    fn current_is_none_after_the_ttl() {
        let clock = ManualClock::new();
        let store = ApprovalStore::with_clock(clock.handle());
        let _ = store.begin(request(XDR_ABC)).unwrap();
        let snapshot = store.current().unwrap();
        assert_eq!(snapshot.state, ApprovalState::Pending);
        assert_eq!(snapshot.mode, ApprovalMode::TouchId);
        assert!(snapshot.expires_at_ms > 0);

        clock.advance(APPROVAL_TTL + Duration::from_secs(1));
        assert!(store.current().is_none());
    }

    #[test]
    fn take_authorized_before_authorization_fails() {
        let store = ApprovalStore::new();
        let outcome = store.begin(request(XDR_ABC)).unwrap();
        assert_eq!(
            store.take_authorized(&outcome.request.id),
            Err(TakeError::NotAuthorized {
                state: ApprovalState::Pending
            })
        );
    }

    #[test]
    fn take_authorized_is_one_time() {
        let store = ApprovalStore::new();
        let outcome = store.begin(request(XDR_ABC)).unwrap();
        store
            .authorize_with(&outcome.request.id, &FakeAuth::ok())
            .unwrap();

        let payload = store.take_authorized(&outcome.request.id).unwrap();
        assert_eq!(payload.unsigned_xdr, XDR_ABC);
        assert_eq!(payload.payload_hash, XDR_ABC_HASH);

        assert_eq!(
            store.take_authorized(&outcome.request.id),
            Err(TakeError::NotAuthorized {
                state: ApprovalState::Consumed
            })
        );
        assert!(store.current().is_none());
    }

    #[test]
    fn deny_moves_a_pending_request_to_denied() {
        let store = ApprovalStore::new();
        let outcome = store.begin(request(XDR_ABC)).unwrap();
        assert_eq!(store.deny(&outcome.request.id).unwrap(), XDR_ABC_HASH);
        let status = store.status(&outcome.request.id).unwrap();
        assert_eq!(status.state, ApprovalState::Denied);
        assert_eq!(status.reason.as_deref(), Some(DENIED_REASON));
        assert_eq!(
            store.take_authorized(&outcome.request.id),
            Err(TakeError::NotAuthorized {
                state: ApprovalState::Denied
            })
        );
    }

    #[test]
    fn status_of_an_unknown_id_is_none() {
        let store = ApprovalStore::new();
        store.begin(request(XDR_ABC)).unwrap();
        assert!(store.status("apr_deadbeef").is_none());
    }

    #[test]
    fn snapshot_and_status_serialize_camel_case_without_the_xdr() {
        let store = ApprovalStore::new();
        let outcome = store.begin(request(XDR_ABC)).unwrap();
        let snapshot = store.current().unwrap();
        let json = serde_json::to_string(&snapshot).unwrap();
        assert!(json.contains(r#""payloadHash":"#));
        assert!(json.contains(r#""expiresAtMs":"#));
        assert!(json.contains(r#""state":"pending""#));
        assert!(!json.contains("unsignedXdr"));
        assert!(!json.contains(XDR_ABC));

        let status = serde_json::to_string(&store.status(&outcome.request.id).unwrap()).unwrap();
        assert_eq!(status, r#"{"id":"apr_0000000000000001","state":"pending"}"#);
    }
}
