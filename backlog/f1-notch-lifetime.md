# Report: F1 — notch lifetime (stays open while a turn is pending)

- **Date:** 2026-09-20
- **Worker/Agent:** opencode worker (deepseek-v4.1-flash)
- **Branch/Worktree:** `fix/f1-notch-lifetime` / `.worktrees/f1-notch-lifetime` (from `integration/wallet`)
- **PR:** none (coordinator commits/opens)

## Completed
- `turnSession.ts`: stages `listening → thinking → speaking → awaiting_approval → signing → submitting → done | error` (`null` = idle). Collapse is reachable only from a terminal stage via `settled`, so no active stage can close the shell.
- Payment path driven by an additive `onStage(stage)` callback: the Touch ID approver calls it before `approvalBegin` (`awaiting_approval`); `signAndSubmit` before `bridge_sign` (`signing`) and before `submit` (`submitting`). `chain.ts` threads `deps.onStage` to both.
- Priority rule: a hotkey take (`capture recording`) while `awaiting_approval|signing|submitting` is refused (same id/stage) with a soft `payment_pending` notice; the ignored take's other capture signals are dropped. `App.runFromTranscript` also ignores a transcript while a payment is pending. Earlier stages keep latest-wins supersede.
- Watchdogs: thinking 30 s, speaking 45 s, approval 140 s, signing 170 s, submitting 60 s, total 6 min. Failures are idempotent (settle once) and land in `error`; `done` collapses at once, `error` after the 5 s dwell.
- Labels: `stageLabel`/`noticeLabel` (en + tr via `@polaris/agent` `languageBase`), e.g. "Approve in Polaris" / "Polaris'te onayla". Session carries the turn language (STT, then the reconciled model language).
- Rust `notch.rs` unchanged: the window never hides and expansion is a React class.

## Files touched
`app/src/lib/{turnSession.ts,turnSession.test.ts,chain.ts,signing.ts,approver.ts}`, `app/src/App.tsx`, docs.

## Verification (real output)
- `npm run check` — 4/4 workspaces tsc clean.
- `npm test -w @polaris/app` — **185 pass / 0 fail** (was 173; +12 reducer tests).
- `npm run build -w @polaris/app` — built in 808 ms (pre-existing dynamic-import warnings only).
- Inline node check: `signAndSubmit` emits `signing,submitting`; approver emits `awaiting_approval`.
- Rust untouched → no cargo run.

## Human verify (not verified here)
- Live Touch ID card + Freighter round trip holding "Approve in Polaris"/"Waiting for Freighter"/"Sending"; a second hotkey press during the wait shows the soft label and is ignored.

## Blocked / handoff
- None.
