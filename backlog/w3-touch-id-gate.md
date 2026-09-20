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
- **Verified:** `cargo test` **153 passed / 0 failed / 5 ignored** (30 of them new
  W3 tests); `cargo clippy --all-targets -- -D warnings` clean; `cargo check`
  clean; `npm run check` clean (interfaces/agent/stellar/app);
  `npm test -w @polaris/app` **19 pass / 0 fail**. The independent review's
  corrections were applied — see **Review fixes** at the end of this report.
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
  the base64 `unsignedXdr` string (the same definition the agent's
  `payloadHashOfXdr` uses on the W1 branch, which is not merged here). It is
  deliberately not the Stellar tx hash (that needs XDR parsing + a passphrase).
  `begin` rejects a mismatch. Pinned by the `SHA-256("abc")` vector and a
  realistic base64 envelope vector. **Scope of the binding:** it binds the XDR
  only; the webview-supplied `summary`/`intent` are *not* cryptographically bound
  to the blob, so a caller can pair a benign summary with a malicious XDR as long
  as it supplies that XDR's hash. The card's hash fingerprint is the only thing
  the user can compare; Rust-side XDR decoding (W4/W5) or an out-of-band hash
  check is what would close this (review F7).
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
  hash match, and rejects `WalletOnly` **unconditionally** (the `origin:
  "anchor"` string escape hatch was removed), then stores one `Pending` entry and
  emits `approval_request`, `agent_status: awaiting_approval`, and (on supersede)
  `approval_result {approved:false}`. `id` is always assigned by the gate
  (`apr_<16 hex>`), never trusted from the caller.
- `approval_authorize(id) -> ApprovalSnapshot`: runs on the **blocking pool** via
  `spawn_blocking`. `TouchId` → real prompt; on success `Authorized` +
  `approval_result {approved:true}` and resolves to the updated snapshot.
  `WalletOnly` → **refused** (`notPending`/`failed`), never a prompt and never
  webview-authorizable. A second concurrent call is `Busy`.
- `approval_deny(id) -> ApprovalSnapshot`: `Pending → Denied` + `approval_result
  {approved:false}`, resolves to the updated snapshot.
- Command failures serialise as `{ kind, message }` (W2 contract): `cancelled`,
  `failed`, `unavailable`, `timeout`, `expired`, `notPending`.
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

`approval.rs` (22): SHA-256 known vectors; empty XDR rejected; hash mismatch;
oversized payload; `WalletOnly` rejected from the webview with **and** without
`origin:"anchor"`; the in-process `begin_wallet_only` creates a request the
webview `authorize` refuses (and `take` rejects); unknown mode rejected by
deserialization; id assignment + supersede; happy path; cancelled / failed /
timeout each leave `Pending`; a panicking authenticator does not wedge the request
`Busy`; TTL expiry blocks authorize + take + current; take-before-authorize fails;
take is one-time (`Consumed`); deny → `Denied`; unknown id → `None`;
snapshot/status serde camelCase and no XDR; the command error serialises as
`{kind,message}`; every gate error maps to the contract kind.

`biometric.rs` (5): empty reason fallback; control/whitespace collapsing;
bidi/zero-width characters stripped; truncation cap; error labels/details
non-empty.

`health.rs` (3): exact `FeatureHealth` wire JSON; lowercase statuses; `checkedAt`
stamped.

Command output (exact):

- `cargo test --manifest-path app/src-tauri/Cargo.toml` →
  `test result: ok. 153 passed; 0 failed; 5 ignored` (lib),
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
- **W4b must not enable `WalletOnly`**, and **W5 (anchor) must land the Rust-side
  check before any `WalletOnly` request is released.** `WalletOnly` is now
  unreachable from the webview (`approval_begin` rejects it unconditionally); the
  only way to create such a request is the in-process
  `ApprovalStore::begin_wallet_only`, which is `pub(crate)` and not a Tauri
  command. W5 is its only intended caller, and only after it has verified the
  anchor payload on the Rust side (e.g. a SEP-10 challenge with sequence number
  0); the webview `approval_authorize` still refuses to authorize a `WalletOnly`
  request. This ordering is also recorded as a `TODO(W5)` doc comment in
  `approval.rs`.
- **W0b (Debug panel):** expose `biometric_health` as an automatic check and
  `biometric_selftest` as an explicit button (it shows a prompt, so never
  automatic).
- **Docs:** the original W3 pass left `backlog.md`/`sprints.md` to a docs worker;
  the W3-fix pass was given both files in scope, so the `backlog.md` "Open Tasks"
  row and the `sprints.md` W3 checkbox were added there.
- **`Cargo.toml` (F3):** the comment at `app/src-tauri/Cargo.toml:25-26` still
  says the digest "matches `payloadHashOfXdr` in the agent (W1)", a function that
  is not on this branch. That file is **outside this task's scope**, so it was
  not touched; the comment needs the same rewording applied here.

## Review fixes

Independent review: `backlog/w3-touch-id-gate-review.md` (verdict APPROVE WITH
CORRECTIONS). All findings addressed in this branch; the corrections were applied
by the original worker, so a fresh independent re-review is still required before
merge.

- **F2 (MAJOR, security) — `WalletOnly` webview bypass: CLOSED.** Removed the
  `origin == "anchor"` string escape hatch entirely (and the `ANCHOR_ORIGIN`
  constant); `ApprovalStore::begin` now rejects any `WalletOnly` request
  unconditionally with `BeginError::WalletOnlyNotAllowed`. Added the in-process
  `#[allow(dead_code)] pub(crate) fn begin_wallet_only(...)` as the **only**
  future constructor of a `WalletOnly` request; it is an inherent method, not a
  free function, so it can never be registered as a Tauri command. The webview
  `authorize_with` now **refuses** to authorize a `WalletOnly` request
  (`AuthorizeError::WalletOnly`), so no webview call can flip one to `Authorized`.
  Tests: `begin_rejects_wallet_only_from_the_webview` (with and without
  `origin:"anchor"`); `begin_wallet_only_creates_a_request_the_webview_cannot_authorize`.
  Constraint recorded in `approval.rs` and `docs/interfaces.md` §8: **W5 must
  land the Rust-side check before any `WalletOnly` request is released; W4b must
  not enable `WalletOnly`.**
- **F1 (MAJOR, integration) — contract adoption: DONE.** Adopted the W2
  contract (`app/src/lib/approval.ts`): `approval_authorize` and `approval_deny`
  now return the updated `ApprovalSnapshot`; the old `{label, detail}`
  `ApprovalFailure` was replaced by `ApprovalCommandError { kind, message }` with
  `ApprovalErrorKind ∈ cancelled | failed | unavailable | timeout | expired |
  notPending` (camelCase `kind`). Mapping: user cancel → `cancelled`, 60 s →
  `timeout`, no biometry/passcode → `unavailable`, TTL/expiry → `expired`,
  unknown/wrong state → `notPending`, everything else (incl. `Busy` and a webview
  `WalletOnly` attempt) → `failed` (fail-closed). Declared the types in
  `interfaces/src/index.ts` §8 and the command contract in `docs/interfaces.md`
  §8. Tests: `approval_command_error_serializes_as_kind_and_message`,
  `gate_errors_map_to_the_contract_kinds`.
- **F5 (MINOR) — panic wedges `Busy`: FIXED.** Added the RAII `InFlightGuard`
  returned by `prepare_authorize`; it clears `in_flight` on drop, so a panic (or
  any early exit) inside the blocking authenticator always restores the state.
  Test: `a_panicking_authenticator_does_not_wedge_the_request`.
- **F3 — dangling references / numbering: FIXED (except one, out of scope).**
  Removed the "matches `payloadHashOfXdr` (W1)" claims from `approval.rs` (W1 is
  not on this branch); the module doc now states the definition without
  referencing the unmerged function. Renumbered the `interfaces/src/index.ts`
  sections to 8 (approval gate) and 9 (feature health) so they no longer collide
  with W1's section 7. **Handoff:** the same dangling claim in
  `app/src-tauri/Cargo.toml:25-26` is **outside this task's file scope** and was
  left untouched — it must be reworded by whoever owns that file.
- **F4 — `docs/interfaces.md`: FIXED.** Added §8 "Approval gate (step W3)" with
  the types and the full command contract.
- **F7 — hash-binding claim: FIXED.** The `approval.rs` module doc and this
  report now state that the hash binds the XDR only; `summary`/`intent` are
  webview-supplied metadata and are not cryptographically bound.
- **F6 — `StackBlock` → `RcBlock`: FIXED.**
- **F10 — bidi/zero-width spoofing: FIXED.** `sanitize_reason` now also strips
  U+200B–U+200F, U+202A–U+202E, U+2066–U+2069 and U+FEFF. Test:
  `bidi_and_zero_width_characters_are_stripped`.
- **F8 — lazy expiry emits no event: DOCUMENTED (not trivial).** The store's
  `status`/`current` cannot emit an `approval_result` because they have no
  `AppHandle` (only the commands do), and the expiry is observed lazily on read.
  Inert today because the card uses `expiresAtMs`; leaving as-is avoids a
  store→command event-plumbing change beyond this fix scope. Tracked for a later
  pass.
- **F9 — `expiresAtMs` mixes monotonic and wall time: DOCUMENTED.** TTL itself is
  monotonic; `expiresAtMs` is informational. No security impact.
- **F11 — missing trailing newline: FIXED** in `interfaces/src/index.ts`.

### Re-verification (review fixes)

- `cargo test --manifest-path app/src-tauri/Cargo.toml` →
  `test result: ok. 153 passed; 0 failed; 5 ignored` (lib); 0 bin; 0 doc.
- `cargo clippy --manifest-path app/src-tauri/Cargo.toml --all-targets -- -D warnings`
  → `Finished` (0 warnings).
- `npm run check` → interfaces/agent/stellar/app all `tsc` exit 0.
- `npm test -w @polaris/app` → `tests 19`, `pass 19`, `fail 0`.

Real Touch ID, the password fallback and cancel remain **not verified** (need a
human on a real Mac).
