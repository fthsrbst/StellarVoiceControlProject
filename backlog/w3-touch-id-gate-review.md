# Independent Review: W3 — Touch ID approval gate (Rust) + pending-approval store

- **Date:** 2026-09-20
- **Reviewer:** independent reviewer (L4), did not write this code
- **Under review:** `feat/w3-touchid-gate` (commits `f549d14`, `a39a7b7`, `9e0488f`) vs `origin/main` (`91e7156`)
- **Report reviewed:** `backlog/w3-touch-id-gate.md`
- **Scope reviewed:** `app/src-tauri/src/{approval,biometric,health}.rs`, `app/src-tauri/src/lib.rs`, `app/src-tauri/Cargo.{toml,lock}`, `interfaces/src/index.ts`

## Verdict: APPROVE WITH CORRECTIONS

The core Touch ID gate is correct, fail-closed on the `touch_id` path, and well
tested. Two corrections are required before merge (both listed under
"Corrections required"). If the `WalletOnly` guard (C1) is not applied, the
verdict must be treated as REJECT, because it is an unguarded bypass of the
entire security control on a value-moving flow.

## What I ran (exact commands, real output)

| Command | Result |
|---|---|
| `export PATH="$HOME/.cargo/bin:$PATH"; caffeinate -i cargo test --manifest-path app/src-tauri/Cargo.toml` | `test result: ok. 150 passed; 0 failed; 5 ignored` (lib); 0 bin; 0 doc |
| `caffeinate -i cargo clippy --manifest-path app/src-tauri/Cargo.toml --all-targets -- -D warnings` | `Finished \`dev\` profile ...` — 0 warnings |
| `npm run check` | `interfaces`, `agent`, `stellar`, `app` all `tsc` exit 0 |
| `caffeinate -i npm test -w @polaris/app` | `tests 19, pass 19, fail 0` |
| `caffeinate -i npm test -w @polaris/agent` | `tests 109, pass 109, fail 0` |
| `caffeinate -i npm test -w @polaris/stellar` | `Test Files 12 passed`, `Tests 112 passed` |
| `cargo tree -i objc2-security` | `error: package ID specification \`objc2-security\` did not match any packages` (confirms the report's "no `objc2-security`" claim) |
| independent SHA-256 check (`node -e crypto...`) | `abc` → `ba7816…15ad`, real envelope → `68e7a6…0fd4` — both match the hard-coded vectors |
| test-count audit | `approval.rs` 20 + `biometric.rs` 4 + `health.rs` 3 = 27 new, matching the report |

The report's pasted numbers are accurate. I did **not** verify the real Touch ID
prompt, the password fallback, or cancel (no human at a real Mac); the report
says the same. `npm test -w @polaris/agent` / `-w @polaris/stellar` were run by
me (the report skipped them) and pass.

## Verified correct

- **No XDR leaves to the webview.** No registered command or event returns
  `unsignedXdr`/`AuthorizedPayload`. `take_authorized` is `pub(crate)` and is not
  in `invoke_handler!` (`lib.rs:53-59`). `ApprovalSnapshot`, `ApprovalStatus`,
  `approval_request`, `approval_result` carry only `payloadHash`/summary/intent.
- **Hash binding.** `begin` rejects `payloadHash != sha256(unsigned_xdr)`
  (`approval.rs:396`); `take_authorized` returns the same stored `unsigned_xdr`
  (`approval.rs:627-632`). The stored entry cannot be swapped without `begin`,
  which replaces `current` under the lock and changes the id.
- **TOCTOU / supersede / one-time use.** `prepare_authorize` holds the lock only
  to plan and sets `in_flight` (`approval.rs:442-464`); `finish_authorize`
  re-checks id, state and expiry under the lock (`approval.rs:469-499`). A
  concurrent `take` during a prompt sees `Pending`; a `begin` during a prompt
  makes the late `finish_authorize` fail `NotFound`. `take_authorized` flips to
  `Consumed` and a second call returns `NotAuthorized { Consumed }`.
- **Clock/TTL.** TTL uses monotonic `Instant`; `epoch_ms_of` uses
  `saturating_duration_since`/`saturating_add`; expiry is re-checked in
  `status`/`current`/`deny`/`take`. `deny`/expiry are terminal and correctly
  reject later `authorize`/`take`.
- **Mutex.** Poisoning is absorbed (`approval.rs:360-364`); the guard is dropped
  before the blocking `authenticate` call — no lock held across the prompt.
- **Fail-closed auth.** Cancelled/failed/timeout leave the request `Pending` and
  release `in_flight` (`approval.rs:515-522`); `evaluate` off-macOS and
  no-biometrics/no-passcode paths return `Unavailable` (`biometric.rs:217-221`,
  `map_error`). Timeout invalidates the context (`biometric.rs:205-210`).
- **Reason + size.** Control chars collapsed, truncated to 120 chars, non-empty
  fallback (`biometric.rs:121-139`); 16 KiB cap checked before hashing.
- **Wire shapes.** `ApprovalMode`/`ApprovalState` snake_case; snapshots/status
  camelCase; `TxSummary`/`Intent` reuse `types.rs`; unknown mode rejected by
  serde (test pins it). All match `interfaces/src/index.ts` sections 7–8.
- **Tests.** 27 new unit tests, all with `FakeAuth`/`ManualClock`; none opens a
  prompt or window. No "cannot fail" test found; the SHA-256 vectors are
  independently reproducible.

## Findings

### F1 — MAJOR (integration): W3's command return/error shape does not match W2's contract

`approval_authorize` returns `Result<(), ApprovalFailure>` (`approval.rs:743-748`)
and `approval_deny` returns `Result<(), ApprovalFailure>` (`approval.rs:777-792`).
The approval-card UI on `feat/w2-approval-card` was written "against the W3 Tauri
command contract" and types both as `Promise<ApprovalSnapshot>` and consumes the
returned snapshot (`app/src/lib/approval.ts:133-149`). After merge,
authorize/deny resolve to `null`, so the card's `authorizing → authorized/denied`
transition reads a null snapshot.

Separately, W3 serialises failures as `{label, detail}` (`approval.rs:644-649`,
mirroring `SpeechFailure`), while W2's `toApprovalError` expects `{kind, message}`
with `kind ∈ cancelled|failed|unavailable|timeout|expired|notPending`
(`app/src/lib/approval.ts:81-98`). Under W3, a user **cancel** or a **timeout**
arrives as `{kind:"failed"}`, so the card cannot show the calm "cancelled → retry"
path. Neither shape is declared in `interfaces/src/index.ts`.

Concrete failure: user cancels the Touch ID prompt → webview receives
`{label:"Cancelled", detail:"…"}` → W2 maps it to `failed` → the panel shows a
terminal error instead of returning to `pending`.

Suggested fix: pick one shape and declare it in `interfaces` (e.g. return the
updated `ApprovalSnapshot` from both commands; emit `{kind, message}` so W2's
normalisation works). If W3 keeps `{label, detail}`, W2 must be updated in the
same merge; do not merge the two branches as-is.

### F2 — MAJOR (security, fail-open): `WalletOnly` is bypassable by the webview

`begin` accepts `mode = WalletOnly` when `origin == ANCHOR_ORIGIN`
(`approval.rs:399-403`), and `authorize_with` treats `WalletOnly` as
`approved = true` without calling the authenticator (`approval.rs:513-514`). Both
`mode` and `origin` are plain webview-supplied JSON fields; `ANCHOR_ORIGIN` is the
string `"anchor"`. There is **no** protection: the marker is exactly a string the
webview can set. W2's card even labels it "Wallet signature required", so this is
a genuinely reachable mode, not a dead branch.

Concrete failure: a script in the window (there is no CSP — `tauri.conf.json:35`
is `"csp": null` — and app-defined Tauri commands are always invokable) calls
`approval_begin({mode:"wallet_only", origin:"anchor", …})` then
`approval_authorize(id)`. No prompt is shown; the request becomes `Authorized`.
Once W4's bridge calls `take_authorized(id)`, the unsigned XDR is released to the
browser with no human gesture. This is latent today only because W4 is not merged;
it becomes a BLOCKER at W4.

The `TODO(W5)` at `approval.rs:381-384` documents this, but a documented bypass is
still a bypass. Suggested fix (before W4 ships): make `WalletOnly` unreachable
until W5 — e.g. return `WalletOnlyNotAllowed` unconditionally, or require an
in-process one-shot token that only Rust-side anchor code can mint (never a
serde-deserializable string). Record the W4↔W5 ordering as a hard constraint.

### F3 — MINOR: W1 references are dangling and section numbers collide

The doc comments and `Cargo.toml:25-26` claim the hash "matches
`payloadHashOfXdr` (W1)", but W1 (`feat/w1-network-wiring`) is **not** an
ancestor of this branch and is not on `origin/main`; that function does not exist
here. (I did verify on the W1 branch that `payloadHashOfXdr` = `sha256Hex(unsignedXdr)`
over the UTF-8 string, so the *definition* matches — but the reference is to an
unmerged branch.) W1's `StellarConfig` is also `interfaces` section **7**, while
W3 adds sections **7** and **8**; both branches append after `AppInfo`, so the
merge will conflict / duplicate the numbering. Merge W1 first and reconcile.

### F4 — MINOR: the declared source of truth (`docs/interfaces.md`) was not updated

`interfaces/src/index.ts`'s header names `docs/interfaces.md` as source of truth
and requires the Rust mirror to stay in sync. The new approval/health types and
the 7 commands are absent from `docs/interfaces.md`. The report lists the docs it
did not touch but omits this file. Add the new section (or delegate explicitly).

### F5 — MINOR: a panic in `authenticate` wedges the request as `Busy` forever

`prepare_authorize` sets `in_flight = true` and drops the lock before
`authenticate` (`approval.rs:456-464`, `507-527`). If `authenticate` panics, the
`spawn_blocking` `JoinError` is caught (`approval.rs:769-772`), but
`finish_authorize` never runs, so `in_flight` stays `true`; every later
`approval_authorize` for that request returns `Busy` until a supersede. Fail-closed
(no release), but a stuck control. Fix: an RAII guard that clears `in_flight` on
drop, or reset it in the `JoinError` arm.

### F6 — NIT: `StackBlock` relies on the framework copying the reply block

`biometric.rs:187-199` passes a `StackBlock` to
`evaluatePolicy_localizedReason_reply`. The comment correctly states the framework
copies the block, but using `RcBlock` would remove the lifetime assumption
entirely. Low risk.

### F7 — NIT: the report's hash-binding claim is stronger than the code

The XDR is bound to `payloadHash`, but the user-facing `summary`/`intent` are
webview-supplied and **not** cryptographically bound to the XDR
(`approval.rs:108-122`, `723-730`). A caller can pair a benign `summary` with a
malicious `unsignedXdr` as long as it also supplies the malicious hash. The
remaining protection is that the card renders the hash fingerprint (W2), which
the user could compare. "A compromised webview cannot get the gate to authorize a
different blob than the one it showed" is therefore imprecise — the gate cannot
verify what was shown. Reword, and note in W4/W5 that only Rust-side XDR decoding
(or a hash the user verifies out-of-band) closes this.

### F8 — NIT: TTL expiry is lazy and emits no event

`status`/`current` flip the state to `Expired` on read (`approval.rs:558-565`,
`579-587`) but no `approval_result` is emitted at expiry, unlike deny/supersede.
A panel relying only on events would never learn. W2 uses `expiresAtMs`, so this
is inert today.

### F9 — NIT: `epoch_ms_of` mixes a monotonic base with wall time

`approval.rs:366-370` derives `expiresAtMs` from `base_epoch_ms` + a monotonic
delta; a system wall-clock jump makes the number misleading. TTL itself is
monotonic, so there is no security impact.

### F10 — NIT: `sanitize_reason` does not strip bidi/zero-width characters

`biometric.rs:121-139` drops `char::is_control()` but keeps U+202E/U+200B, which
could spoof the prompt string. Low risk since the caller builds `"Approve {title}"`.

### F11 — NIT: missing trailing newline

`interfaces/src/index.ts` ends without a newline (`Cargo.toml` is pre-existing).

## Attack-question summary (task checklist)

| Question | Finding |
|---|---|
| Webview obtain the XDR? | No. No command/event returns it; `take_authorized` is in-process only. |
| Authorize without real Touch ID? | `touch_id`: no. `wallet_only`: **yes** — see F2. |
| Authorize one XDR, release another? | No. `begin` enforces hash binding; `take` returns the same stored blob. |
| TOCTOU authorize/take? | Safe — lock-serialised; `take` requires `Authorized`. |
| Supersede races? | Safe — old in-flight `finish_authorize` fails `NotFound`. |
| TTL/clock/overflow? | Safe (monotonic TTL, saturating u64 ms). NIT F9. |
| One-time consumption? | Safe — `Consumed` on take; second take rejected. |
| State after Denied/Expired? | Terminal and correctly rejected by later calls. |
| `WalletOnly` skip? | **Yes** — origin is a webview-set string; F2. |
| Mutex poisoning / lock across blocking call? | Handled; lock not held across the prompt. |
| Timeouts / thread leaks? | Bounded at 60 s; blocking task always awaited. |
| LA callback / `unsafe` / context lifetime / block2? | Context kept alive across receive; timeout invalidates; no-biometrics → `Unavailable`. NIT F6. |
| Reason sanitisation? | Control+whitespace collapse, 120-char cap, non-empty fallback. NIT F10. |
| Payload cap? | 16 KiB, checked pre-hash. |
| serde shapes vs `interfaces`? | Match for the declared types. F1 covers the **undeclared** command error shape. |
| Snapshot/events/status include XDR? | No. |
| A test shows a real prompt? | No — correctly all fakes. |

## Corrections required

1. **C1 (F2):** hard-guard `WalletOnly` so the webview cannot authorize without a
   real signal, or formally block W4 until W5 removes the string check. The
   `origin` marker must not be treated as a protection.
2. **C2 (F1):** reconcile the `approval_authorize`/`approval_deny` return values
   and the error shape with W2, and declare the chosen shape in
   `interfaces/src/index.ts`; do not merge W2 and W3 as-is.

Recommended before merge: F3 (merge order/section collision), F4 (docs),
F5 (panic guard).

## Blocked / handoff

- I made **no** changes other than this review file; nothing committed or pushed.
- Anything requiring a human (real Touch ID, password fallback, cancel) is
  **not verified** by me.
