# Report: W6c — Wallet panel (real content) + Suggestions panel
- **Date:** 2026-09-20 · **Worker:** opencode worker (deepseek-v4.1-flash)
- **Branch/Worktree:** `feat/w6c-wallet-suggestions` / `.worktrees/w6c-wallet` · **PR:** none (worker leaves changes uncommitted; coordinator commits)
## Completed
- **Wallet** (`#/wallet`): network badge; owner short address + copy + explorer; XLM/trustline balances and last 10 payments (direction, counterparty alias, amount, time, explorer) read from Horizon via `stellar_config`; alias book (env `POLARIS_ALIASES` over committed `aliases.json`); Refresh; clear states for owner-not-configured, account-not-funded (Friendbot link), Horizon offline and loading.
- **Suggestions** (`#/suggestions`): owner Horizon payments → `HistoryRecord[]` → pure `suggest()`; each suggestion shows title, rationale (evidence sentence), aggregate evidence line and confidence; **Accept** opens the relevant panel (`open_panel`) and copies a draft — never signs/submits; **Dismiss** persists in `localStorage` (try/catch) and can be cleared.
- Debug checks `wallet.ts` (Horizon reachable, owner found, balance count) and `suggestions.ts` (history fetched, `suggest()` ran, N suggestions); both non-destructive.
## Files
- New: `app/src/lib/history.ts` (+ test), `app/src/panels/wallet/walletModel.ts` (+ test), `app/src/panels/suggestions/{suggestionsModel,dismissals}.ts` (+ tests), `app/src/debug/checks/{wallet,suggestions}.ts`.
- Replaced bodies: `app/src/panels/{WalletPanel,SuggestionsPanel}.tsx`. Docs: this report + one row in `backlog.md` + one line in `sprints.md`.
## Decisions
- Auto-pay is treated as **off** (no live guard rule read), so `tighten_dormant` never fires here — honest, non-destructive.
- Accept cannot prefill another window across windows, so it copies a labelled draft (public data only) and opens the target panel; `unusual_payment_alert` (no flow) is acknowledged locally.
- `HistoryRecord`s are outgoing-only, `public`, `confirmed`; amounts parsed float-free at 7 decimals. Debug-check logic stays in the owned lib/panel modules (helpers must not sit under `debug/checks/`).
## Tests
- `npm run check -w @polaris/app` clean · `npm test -w @polaris/app` **202 pass / 0 fail** (was 173; +29) · `npm run build -w @polaris/app` green. Rust/other suites untouched (not run).
## Human-verify (not verified)
- Real-Mac panel windows; live Horizon fetch; copy buttons/explorer links; Accept opening Security/Schedules; `npm run dev`.
## Blocked / handoff
- None. Accept's prefill is limited by the cross-window API (`open_panel` takes no payload); a future shared draft channel would remove the clipboard step.
