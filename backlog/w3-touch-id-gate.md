# Report: W3 — Touch ID approval gate (Rust) + pending-approval store

- **Date:** 2026-09-20
- **Worker/Agent:** opencode-go/deepseek-v4.1-flash (L2, W3)
- **Branch/Worktree:** `feat/w3-touchid-gate` / `.worktrees/w3-touchid`
- **PR:** none (left uncommitted per task; coordinator opens the PR)

## TL;DR

- Added a Rust-enforced, fail-closed Touch ID **approval gate** for value-moving
  actions. The gate authorizes the release of **one specific unsigned XDR** to the
  Freighter bridge; signing stays in the user's browser wallet and the app holds no
  secret keys.
- `biometric.rs`: `Authenticator` trait + real macOS `LAContext.evaluatePolicy`
  implementation, `AuthError` taxonomy, reason sanitizing, 60 s timeout, and a
  non-prompting policy probe for health.
- `approval.rs`: one-entry pending-approval state machine
  (`Pending → Authorized | Denied | Expired → Consumed`), 120 s TTL, hash binding,
  the four webview commands, `approval_current` hydration, and the in-process
  `take_authorized` release path.
- `health.rs`: the shared `FeatureHealth` Debug-contract struct plus
  `biometric_health` (no prompt) and `biometric_selftest` (real prompt button).
- **Verified:** `cargo test` **150 passed / 0 failed / 5 ignored** (27 of them new
  W3 tests); `cargo clippy --all-targets -- -D warnings` clean; `cargo check`
  clean; `npm run check` clean (interfaces/agent/stellar/app);
  `npm test -w @polaris/app` **19 pass / 0 fail**.
- **Not verified (needs a human on a real Mac):** the actual Touch ID prompt,
  the password fallback, and cancelling the prompt.

## Files

New:

| File | What it is |
|---|---|
| `app/src-tauri/src/biometric.rs` | `Authenticator` trait, `SystemAuthenticator`, `AuthError`, `sanitize_reason`, `policy_support`/`BiometryKind`. macOS path uses `objc2-local-authentication`. |
| `app/src-tauri/src/approval.rs` | `ApprovalStore`, `ApprovalRequest`, `ApprovalSnapshot`, `ApprovalStatus`, `AuthorizedPayload`, the state/error enums, the four Tauri commands, and the test suite. |
| `app/src-tauri/src/health.rs` | `FeatureHealth`, `HealthStatus`, `now_ms`, `biometric_health`, `biometric_selftest`. |
| `backlog/w3-touch-id-gate.md` | This report. |

Modified (minimal, additive):

| File | Change |
|---|---|
| `app/src-tauri/Cargo.toml` | Added `sha2 = "0.10"`, `hex = "0.4"`; added `objc2-local-authentication` (macOS) with `default-features = false` and `LABiometryType`/`LAContext`/`LAError`/`block2`; added `NSString`/`NSError` to `objc2-foundation`. Removed the stale "Step A5 will add… Touch ID" comment. |
| `app/src-tauri/Cargo.lock` | Added `objc2-local-authentication 0.3.2` (+ its `block2`/`objc2`/`objc2-foundation` deps only — **no `objc2-security`**); `polaris-app` now lists `hex`, `sha2`, `objc2-local-authentication`. |
| `app/src-tauri/src/lib.rs` | Declared `mod approval/biometric/health`; registered the 7 new commands in `invoke_handler!`; `app.manage(ApprovalStore::new())` + `app.manage(biometric::system())` in `setup`. |
| `interfaces/src/index.ts` | Added sections 7 (approval gate types) and 8 (`FeatureHealth`/`HealthStatus`) — additive only, each with a Rust mirror. |

`events.rs` was **not** touched: `approval_request`, `approval_result` and
`agent_status` already exist and are reused unchanged. `Info.plist` was **not**
touched: `LAContext` needs no usage-description string on macOS. `panels.rs`,
React files, `agent/`, `stellar/`, `backlog.md` and `sprints.md` were not touched
(task scope; docs worker owns the index/checklist).

## Decisions (explicit)

- **Policy = `LAPolicy::DeviceOwnerAuthentication`.** Touch ID first, device
  password as the documented fallback when biometry is unavailable/locked
  (lid closed, no finger enrolled). The property the gate needs is "a human is
  present at this Mac", and a password is a legitimate present-human proof;
  refusing it would lock the user out on a Mac without Touch ID.
- **`objc2-local-authentication` with default features off.** Its default set
  pulls `objc2-security` (Keychain / access-control), which `evaluatePolicy` does
  not use. Disabling defaults avoids linking an otherwise-unneeded framework.
- **Hash binding.** `payloadHash` = lowercase hex SHA-256 of the UTF-8 bytes of
  the base64 `unsignedXdr` string, matching `payloadHashOfXdr` (W1). It is
  deliberately not the Stellar tx hash (that needs XDR parsing + a passphrase).
  `begin` rejects a mismatch. Pinned by the `SHA-256("abc")` vector and a
  realistic base64 envelope vector.
- **TTL = 120 s from `begin`** (not reset on authorize). One prompt is bounded at
  60 s, so there is always time left to hand off.
- **One entry only.** A new `begin` replaces the old one; if the old was
  `Pending`/`Authorized` it is reported as superseded (`approval_result
  {approved:false}` is emitted with its hash). Because the store keeps a single
  entry, `approval_status(oldId)` afterwards returns `None`; the notification is
  the event + the hash returned by `begin`.
- **Auth failure leaves the request `Pending`.** Cancelled/failed/timeout are not
  decisions: the panel may retry or explicitly deny. Only `authorize` success
  (`Authorized`), `deny`, supersede, and TTL produce terminal states there.
- **Reason string** is built by the gate as `"Approve {summary.title}"` (e.g.
  `Approve Send 10 XLM`) and sanitized in `biometric.rs` (control chars dropped,
  whitespace collapsed, truncated to 120 chars, non-empty fallback).

## Behaviour

- `approval_begin(request) -> id`: validates non-empty XDR, size cap (16 KiB),
  hash match, and — for `WalletOnly` — `origin == "anchor"`, then stores one
  `Pending` entry and emits `approval_request`, `agent_status: awaiting_approval`,
  and (on supersede) `approval_result {approved:false}`. `id` is always assigned
  by the gate (`apr_<16 hex>`), never trusted from the caller.
- `approval_authorize(id)`: runs on the **blocking pool** via `spawn_blocking`.
  `TouchId` → real prompt; on success `Authorized` + `approval_result
  {approved:true}`. `WalletOnly` → no prompt. A second concurrent call is `Busy`.
- `approval_deny(id)`: `Pending → Denied` + `approval_result {approved:false}`.
- `approval_status(id) -> Option<ApprovalStatus>` (state + deny/supersede reason).
- `approval_current() -> Option<ApprovalSnapshot>`: hydrates a panel that opened
  after the event; **never includes `unsignedXdr`**.
- `take_authorized(id)` (in-process, `pub(crate)`, not a command): returns the
  XDR only if `Authorized` and unexpired, and marks it `Consumed`; a second call
  fails. It is the only path by which XDR leaves the gate.
- `biometric_health` (no prompt) and `biometric_selftest` (real prompt, reason
  "Polaris self-test — no funds are moved").

## Tests

New unit tests (all with a fake `Authenticator` / injected clock; none shows a
prompt or opens a window):

`approval.rs` (20): SHA-256 known vectors; empty XDR rejected; hash mismatch;
oversized payload; `WalletOnly` rejected without `origin:"anchor"`; accepted with
it; unknown mode rejected by deserialization; id assignment + supersede; happy
path; cancelled / failed / timeout each leave `Pending`; `WalletOnly` never
prompts; TTL expiry blocks authorize + take + current; take-before-authorize
fails; take is one-time (`Consumed`); deny → `Denied`; unknown id → `None`;
snapshot/status serde camelCase and no XDR.

`biometric.rs` (4): empty reason fallback; control/whitespace collapsing;
truncation cap; error labels/details non-empty.

`health.rs` (3): exact `FeatureHealth` wire JSON; lowercase statuses; `checkedAt`
stamped.

Command output (exact):

- `cargo test --manifest-path app/src-tauri/Cargo.toml` →
  `test result: ok. 150 passed; 0 failed; 5 ignored` (lib),
  `0 passed; 0 failed` (bin), `0` doc-tests.
- `cargo clippy --manifest-path app/src-tauri/Cargo.toml --all-targets -- -D warnings`
  → `Finished` (no warnings).
- `cargo check --manifest-path app/src-tauri/Cargo.toml` → `Finished`.
- `npm run check` → all four workspaces (`interfaces`, `agent`, `stellar`, `app`)
  exited clean.
- `npm test -w @polaris/app` → `tests 19`, `pass 19`, `fail 0`.
- `npm test -w @polaris/agent` / `-w @polaris/stellar`: not run (untouched).

## Needs a human (real Mac)

- That the **Touch ID prompt actually appears** with the expected reason, that a
  successful tap authorizes, that the **device-password fallback** appears on a
  Mac without enrolled biometry, and that **cancelling** yields `Cancelled` and
  leaves the request `Pending`. All of these go through `SystemAuthenticator`,
  which cannot be exercised in CI. `biometric_health` and `biometric_selftest`
  are the two commands to use for a manual check.

## Blocked / handoff

- **W4 (Freighter bridge server):** must call `ApprovalStore::take_authorized(id)`
  in-process to fetch the XDR. That method is intentionally not a Tauri command.
- **W5 (anchor):** the `origin: "anchor"` gate on `WalletOnly` is a **placeholder**
  (`TODO(W5)` in `approval.rs`): the webview could forge the string. The anchor
  milestone must bind wallet-only mode to a Rust-verifiable signal (e.g. a SEP-10
  challenge with sequence number 0) and then remove/replace the string check.
- **W0b (Debug panel):** expose `biometric_health` as an automatic check and
  `biometric_selftest` as an explicit button (it shows a prompt, so never
  automatic).
- **Docs worker:** add the `backlog.md` "Open Tasks" row and the `sprints.md`
  checkbox for W3; this report does not edit those two files (per task scope).
