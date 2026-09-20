# Report: F4 — make failures visible and specific
- **Date:** 2026-09-20 · **Worker:** opencode worker (deepseek-v4.1-flash) · **Branch:** `fix/f4-visible-errors` · **PR:** none (coordinator commits)

## What / why
A voice payment failed with only the spoken label "Chain error"; the real cause (unknown recipient) never reached the terminal or the Debug panel. Webview failures now reach both, and common refusals get specific labels.

## Files
- `app/src-tauri/src/weblog.rs` (new): `polaris_log(level,message,emit)` prints `polaris: web[<level>] <redacted, ≤400 chars>`; the redactor strips `sk-…`/`gsk_…`, 56-char `S…` seeds, ≥40-char base64/hex runs and `Bearer …`, keeps public `G…`; `emit` mirrors the detail as `error { message }`. Registered additively in `lib.rs`.
- `app/src/lib/weblog.ts` (new): `webLog(level,message,emit?)` — never throws, console fallback outside Tauri.
- `app/src/main.tsx`: `error` / `unhandledrejection` window hooks (additive).
- `app/src/lib/chain.ts`: logs each non-executed `SubmittedOutcome` (label, detail, intent kind/asset/amount/recipient; never XDR).
- `app/src/lib/{approver.ts,signing.ts}`: one-line logs on deny/expire/timeout and every signing failure; `submissionLabel` adds "Network unreachable".
- `agent/src/errors.ts`: `REFUSAL_LABELS` + `refusalLabel(code)`; `execution.ts` uses it instead of generic "Chain error". `agent/src/errors.test.ts` (new) covers every `PaymentRefusal` code.

## Tests (real output)
`npm run check` 4/4 workspaces pass · `npm test -w @polaris/agent` 129 passed/0 failed · `npm test -w @polaris/app` 173 passed/0 failed · `cargo test` 233 passed/0 failed/5 ignored · `cargo clippy -- -D warnings` clean.

## Decisions
No new Rust dependency (hand-written, over-redacting scanner); refusal labels are plain strings matched structurally, so `stellar/` is unchanged.

## Blocked / handoff
Spoken **tr** for the *new* labels needs their sentences added to `FAILURE_SENTENCES` in `agent/src/speech.ts` — outside this task's file scope, so left untouched. Until then `failureSentence` speaks the English label for them (approval/wallet labels already localize).

## Human verify (not verified here)
A bad recipient should print one terminal line, show in the Debug event tail and speak the specific label; real mic / Touch ID / Freighter behavior is unchanged.
