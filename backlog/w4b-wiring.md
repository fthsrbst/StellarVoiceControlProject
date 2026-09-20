# Report: W4b-2 — Wire approval → Touch ID → Freighter signing → submit → explorer link (TypeScript side)

- **Date:** 2026-09-20
- **Worker/Agent:** opencode worker (deepseek-v4.1-flash)
- **Branch/Worktree:** `feat/w4b-wiring` in `.worktrees/w4b-wiring` (from `integration/wallet`)
- **PR:** none yet (coordinator commits after review)

## Objective

Complete the TypeScript half of W4b: bind the `IntentApprover` seam to the Rust
Touch ID gate, drive `bridge_sign` → `submitSignedTx` → `tx_submitted`, enrich the
execution outcome so the shell can announce the result, add the one narrow Rust
`tx_submitted_emit` command the webview needs, and ship the W4b Debug checks.

## Completed

1. **Seam extension (additive)** — `agent/src/execution.ts`
   - `ApprovalRequest` gains `unsignedXdr` (the exact blob the gate will bind to
     `payloadHash`).
   - `ApprovalDecision` gains optional `approvalId`; `ExecutionOutcome` gains
     optional `approvalId`. `executeIntent` copies it through on an executed
     outcome so the signing step can release exactly that blob.
   - Existing defaults (deny-all `resolveApprover(false)`, auto placeholder
     opt-in) are unchanged; tests updated and extended.

2. **Touch ID approver** — `app/src/lib/approver.ts` (new)
   - `createTouchIdApprover(deps)` calls `approval_begin({ payloadHash,
     unsignedXdr, summary, intent, mode: "touch_id" })`, opens `#/approval`, then
     waits (≤ 130 s, `APPROVER_TIMEOUT_MS`) on the `approval_result` event **and**
     an `approval_status` poll (750 ms) as fallback.
   - Approval is returned **only** when the gate reports the exact `payloadHash`
     as `authorized`; denied/expired/timeout/superseded/error are `false`. A
     matching event triggers a gate re-read, so a rogue event cannot fabricate an
     approval (the gate state is authoritative). A rejected `approval_begin`
     propagates as a fail-closed error.
   - Full DI (`invoke`, `open`, `subscribe`, clock/timers) so every branch is
     testable without Tauri or real time.
   - `app/src/lib/approval.ts` gains `approvalBegin`/`approvalStatus` wrappers and
     an `ApprovalStatus` type.

3. **Sign + submit** — `app/src/lib/signing.ts` (new)
   - `signAndSubmit(outcome, deps)`: `invoke("bridge_sign", { id })` → on `ok`
     `submitSignedTx(signedXdr, unsignedXdr)` → verify the returned hash equals
     Rust's `txHash` (case-normalised) → `emitSubmitted` → return
     `{ ..., txHash, explorerUrl, signerAddress }`.
   - Every failure maps to a short label (`Wallet didn't sign`, `Signature check
     failed`, `Wallet timed out`, `Transaction expired` for `tx_bad_seq`/`tx_too_late`,
     `Not enough balance` for `op_underfunded`, `Transaction mismatch` for hash
     inequality, `Submit failed`/`Signing error` otherwise). Never throws.

4. **`chain.ts` composition root**
   - Selects the Touch ID approver when a Tauri runtime is present (`isTauri()`);
     `POLARIS_ALLOW_AUTO_APPROVE=1` now only installs the placeholder **outside**
     Tauri, so the auto path can never move real value in the app.
   - `executeApprovedIntent(intent)` now builds → approves → signs → submits and
     returns `SubmittedOutcome` (enriched with `txHash`/`explorerUrl`). Lazy
     imports preserved.

5. **Spoken output** — `agent/src/speech.ts`
   - `submittedSentence(intent, language)`: “Sent 10 XLM to acc2.” / “acc2'ye 10
     XLM gönderildi.”
   - `failureSentence(label, language)`: short tr/en failures (“Cancelled” /
     “İptal edildi”, “Wallet didn't sign” / “Cüzdan imzalamadı”, …), unknown labels
     spoken verbatim. Both capped by `capSpokenText`.
   - `app/src/lib/speech.ts` gains `speakSentence(text, language, onFailure)`.

6. **Minimal App.tsx edit** (frontend owner owns the file): on an executed
   outcome with a `txHash`, speak `submittedSentence`; on any failure, speak
   `failureSentence` and keep the existing labelled failure dispatch. The
   conversational-turn path is untouched.

7. **Rust event emission** — `app/src-tauri/src/tx_events.rs` (new) +
   `lib.rs` (one `mod` line + one handler line)
   - `tx_submitted_emit(hash, explorerUrl)` validates `hash` = 64 lowercase hex and
     `explorerUrl` = `https://stellar.expert/explorer/testnet/tx/<hash>` exactly,
     then emits the existing `PolarisEvent::TxSubmitted`. Refusals return a typed
     `{ kind, message }` and emit nothing. Validation is unit-tested.

8. **Debug checks** (milestone `W4`) — `app/src/debug/`
   - `network.ts`: `stellar_config` loaded, network testnet, owner present and
     well-formed, alias `acc2` resolves, Horizon reachable and the owner account
     exists — balance in `detail`; warn for missing command/owner, fail for wrong
     network / bad owner / unresolved alias / unreachable Horizon / missing or
     unfunded account.
   - `approval.ts`: `biometric_health` → status; action “Test Touch ID (no funds)”
     → `biometric_selftest`.
   - `bridge.ts`: `bridge_health`; action “Test Freighter signing (no funds)”
     builds an owner→owner 1 XLM native payment with **sequence 0** via
     `@stellar/stellar-sdk` and passes its XDR to `bridge_selftest`; description
     states it opens the browser and never submits.
   - `submit.ts`: static — `submitSignedTx` importable and the explorer link is
     the testnet one; no side effects.
   - Checks feature-detect commands and degrade to `unknown`/`warn`, so the panel
     works before the Rust half is merged.
   - Pure logic is in `app/src/debug/checkHelpers.ts` (outside `checks/`, per
     `docs/debug-panel.md`) so it is unit-testable under `node:test`.

9. **Docs**: `docs/ui-panels.md` §9 “Signing flow”.

## Files touched

- `agent/src/{execution.ts,execution.test.ts,speech.ts,speech.test.ts,index.ts}`
- `app/src/lib/{approval.ts,approver.ts,approver.test.ts,signing.ts,signing.test.ts,chain.ts,speech.ts}`
- `app/src/debug/{commands.ts,checkHelpers.ts,checkHelpers.test.ts}`
- `app/src/debug/checks/{network,approval,bridge,submit}.ts`
- `app/src-tauri/src/{tx_events.rs,lib.rs}`
- `app/src/App.tsx` (minimal)
- `docs/ui-panels.md`, `backlog/w4b-wiring.md`, `backlog.md`, `sprints.md`

## Decisions

- **`approvalId` threading**: the gate id had to reach the signing step. It was
  added additively to `ApprovalDecision`/`ExecutionOutcome` rather than making the
  bridge re-begin a request (which would need the XDR again and break the
  one-request-at-a-time gate).
- **Gate state is authoritative**: an `approval_result` event only triggers a
  re-read of `approval_status`; a fabricated event cannot flip the decision.
- **Sequence-0 self-test**: `TransactionBuilder.build()` emits
  `sequenceNumber + 1`, so the builder starts the synthetic account at `-1` to
  produce the required sequence-0 envelope. It never touches the network.
- **Milestone tag** in Debug checks is `W4` because the contract type is
  `` `W${number}` ``; the `b` is not expressible in the tag.
- The Vite build prints three `INEFFECTIVE_DYNAMIC_IMPORT` notices for
  `approver.ts` (dynamic imports of `@/lib/polaris`, `@/lib/panels`,
  `aliases.json`). They are benign (those modules are statically imported
  elsewhere) and are the price of keeping `approver.ts` importable by
  `node:test` without the `@/` alias.

## Test output (real)

```
npm run check                       -> clean (all 4 workspaces)
npm test -w @polaris/app            -> tests 159  pass 159  fail 0
npm test -w @polaris/agent          -> tests 126  pass 126  fail 0
npm run build -w @polaris/app       -> built in 755 ms (852 modules)
cargo test --manifest-path app/src-tauri/Cargo.toml
                                    -> test result: ok. 180 passed; 0 failed; 5 ignored
cargo clippy ... -- -D warnings     -> Finished (no warnings)
```

New suites: `app/src/lib/approver.test.ts` (10), `app/src/lib/signing.test.ts`
(15), `app/src/debug/checkHelpers.test.ts` (13), plus 7 new cases in
`agent/src/speech.test.ts` and 3 new cases in `agent/src/execution.test.ts`. Rust
`tx_events.rs` adds 6 unit tests.

## What needs the Rust half (W4b-1) merged to be observed live

- `bridge_sign`, `bridge_selftest`, `bridge_health` do not exist on this branch;
  the Debug `bridge` check reports `unknown` and the signing path would label a
  missing-command rejection as `Signing error`. The TS side is coded strictly
  against the shared contract and tested with an injected `invoke`.

## Not verified (needs a human on a real Mac)

- Touch ID prompt, the approval card actually opening, Freighter signing in the
  browser, and a real testnet payment reaching stellar.expert. These require
  macOS biometrics, Freighter on Testnet and the Rust half.

## Blocked / handoff

- None blocking. `stellar/` was called, not changed; `submitSignedTx` needed no
  change. No secret material is read or returned anywhere in this work.
- `POLARIS_ALLOW_AUTO_APPROVE` remains opt-in and, in this change, is unusable
  inside a Tauri runtime; the deny-all default is unchanged.

## Suggested next step

- W4b-1 (Rust) lands `bridge_sign`/`bridge_selftest`/`bridge_health`; then run the
  two Debug actions (“Test Touch ID”, “Test Freighter signing”) and one real
  acc1→acc2 XLM payment end to end.
