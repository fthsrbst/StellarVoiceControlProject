# Report: NW3 — Notch Tasks page → real scheduled payments

- **Date:** 2026-09-20
- **Worker/Agent:** opencode worker (deepseek-v4.1-flash)
- **Branch/Worktree:** `feat/nw3-tasks-page` / `.worktrees/nw3-tasks`
- **PR:** none (coordinator opens it)

## What was done

Replaced the Tasks page's mock array with a real data source and added Cancel.

- `app/src/notch/data/useTasksData.ts` (new): pure mappers
  `rowsFromUpcoming` (`loadUpcoming` → `toScheduleRows` → `TaskRow`),
  `rowsFromMock`, the `tasksSource` demo/live rule and `cancelIntentFor`; a thin
  `useTasksData` hook that loads the list (refresh on demand) and runs Cancel.
- `app/src/notch/pages/TasksPage.tsx`: renders `TaskRow`s (amount → alias,
  recurrence, runs left, status, next run **local + UTC**), a keeper hint
  (`keeperStatus` command), Cancel per row through the shared pipeline, an
  error + Retry state, and an empty state pointing at the voice example.
- `app/src/notch/data/useTasksData.test.ts` (new): 6 `node:test` cases for the
  mappers/rule/intent.

## Decisions

- **View model, not the old `ScheduledTask`.** The required fields (local+UTC,
  runs left, cancel id) do not exist on `ScheduledTask`; the hook adapts at the
  boundary per the wiring rules. Mock rows are kept as an explicit demo only
  (not in Tauri, or no owner address); a real read error shows Retry, never mock.
- **Removed the mock "new task" form and enable toggle.** Neither is backed by
  the chain (`listUpcoming` is read-only; there is no pause), so keeping them
  would lie. Schedule creation stays a voice action → empty state points at it.
- **Cancel reuses the existing seams** (`cancelChainTool` + `useTxRun`); no new
  value path, no new Debug check (same `listUpcoming` source as `schedules`).

## Verification (exact counts)

- `npm run check -w @polaris/app` — pass (tsc clean).
- `npm test -w @polaris/app` — **299 pass / 0 fail** (was 293; +6 new).
- `npm run build -w @polaris/app` — built OK (only pre-existing Vite
  INEFFECTIVE_DYNAMIC_IMPORT warnings, same as `chain.ts`/`txPipeline.ts`).

## Needs a human (real notch)

- Hover the notch → Tasks: real testnet rows, Cancel approval card + Touch ID +
  Freighter, and the keeper hint. **Not verified** (no running Tauri/mic/Freighter).

## Blocked / handoff

- None.
