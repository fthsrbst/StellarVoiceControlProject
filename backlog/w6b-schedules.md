# Report: W6b — Scheduled payments (voice + "Upcoming payments" panel)

- **Date:** 2026-09-20
- **Worker/Agent:** opencode worker (deepseek-v4.1-flash)
- **Branch/Worktree:** `feat/w6b-schedules`
- **PR:** none (coordinator commits)

## Completed
- **Interfaces (additive):** `IntentKind` gains `schedule_payment` + `cancel_schedule`; `Intent` gains `firstRun` (wall-clock + explicit IANA zone), `repeat`, `runs`, `scheduleId`, `which`.
- **Agent voice:** `agent/src/tools/schedule.ts` validates model args into those intents. The model resolves "tomorrow"/"her cuma" to `firstDate`/`firstTime`; the tool fills the device zone (`ToolContext.timeZone`) unless the user named one. A repeat with no `runs` is refused so the agent asks "for how many?". tr/en cadence + disambiguation words canonicalise. Registered in `createDefaultRegistry`; `prompt.ts` adds schedule rules + a current-time line (`withClock`); `describeIntent` names the kinds.
- **App wiring:** `lib/schedules.ts` is pure (view model, keeper status, form → `ScheduleDraft`+`Intent`, local+UTC preview, cancel disambiguation, Debug health). `lib/schedulesLive.ts` binds it to real RPC/guard/allowance (SAC id derived locally, never from input). `lib/chain.ts` routes both kinds through the existing seam/approver.
- **Panel:** `panels/SchedulesPanel.tsx` + `panels/schedules/*` — list (next run local + UTC, amount, recipient, recurrence, runs left, status badge), Cancel via `useTxRun`/`runTx` (Touch ID), New-schedule form, keeper strip (shows the command, never starts a process).
- **Debug check:** `debug/checks/schedules.ts` — config/owner/guard, list readable, count; `warn` when the guard rule or SAC allowance is missing (runs settle through `transfer_from`).

## Decisions
- Device zone is injected, never assumed inside the chain tool; the card shows local **and** UTC (already in the `@polaris/stellar` summary).
- Schedule tools are approval-gated and never run in the turn, like `send_payment`.
- Panels reuse `runTx`; no panel signs, holds a key, or starts the keeper.
- **Scope note:** wiring needed three small additive edits beyond the literal agent list — `agent/src/runtime.ts` (register the tools), `agent/src/index.ts` (exports), `agent/src/loop.ts` (inject the current-time line via `withClock`; kind-aware `describeIntent`). Flagged for the coordinator.

## Tests (all run here)
- `npm run check` (interfaces/agent/stellar/app) → clean.
- `npm test -w @polaris/agent` → **139 pass / 0 fail** (12 new: tr/en parsing, zone override/reject, repeat/runs rules, cancel validation).
- `npm test -w @polaris/app` → **185 pass / 0 fail** (12 new `lib/schedules.test.ts`: view model, keeper status, form, DST gap + overlap, cancel disambiguation, health).
- `npm test -w @polaris/stellar` → **1009 pass / 0 fail** (unchanged; only `interfaces` touched).

## Blocked / handoff
- **BLOCKING — Rust `IntentKind` mirror.** `app/src-tauri/src/types.rs` `IntentKind` lacks `SchedulePayment`/`CancelSchedule` (and `Intent` lacks the new optional fields), so `approval_begin` rejects a schedule intent and **no schedule create/cancel can reach Touch ID**. Needs an additive Rust patch (out of my scope): add the two enum variants; add `first_run`/`repeat`/`runs`/`schedule_id`/`which` as `Option` fields with `#[serde(default, skip_serializing_if = "Option::is_none")]` (unknown fields are otherwise ignored). Until then the panel/voice paths fail closed with an `Approval error`.
- **Live testnet demo not run** (create → keeper fires ~15–25 s → cancel): needs a funded owner/keeper + `GUARD_CONTRACT_ID`; human.
- **Voice cancel disambiguation:** several matches for one recipient surface the typed `ScheduleAmbiguous` message through the failed outcome; asking "which one?" in-turn needs a follow-up read tool.
- **Human-verify:** real Touch ID + Freighter, the panel windows on a Mac, device-zone conversion.
