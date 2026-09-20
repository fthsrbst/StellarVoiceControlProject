# NW4 — Notch History page → real voice turns + on-chain history

**Branch:** `feat/nw4-history-page` · **Status:** done, in review
**Files:** `lib/turnLog.ts` (+test), `notch/data/{historyModel.ts,+test,useHistoryData.ts}`,
`notch/pages/HistoryPage.tsx`, `App.tsx` (additive), `debug/checks/history.ts`, `index.css` (one rule).

## What / why
- `turnLog.ts`: 50-entry `localStorage` ring buffer (start → answer → outcome) fed from `App.tsx`.
  Reads whitelist only transcript/answer/outcome/txHash/explorerUrl, so no XDR/secret re-enters;
  all storage calls try/catch and best-effort.
- `historyModel.ts`: pure mappers merging local turns + Horizon payments, newest first, dropping a
  chain row that echoes a submitted turn's tx hash.
- `useHistoryData.ts`: reads on panel open + Refresh (no polling). Mock only when not in Tauri or no
  owner address; a failed real read shows the error + Retry, never mock.
- `HistoryPage.tsx`: data source swapped only; kept Fatih's rows/expand. Added Refresh + "Clear local
  history"; the expanded hash links to stellar.expert. `history` Debug check added.

## Verified
`npm run check` ✅ · `npm test -w @polaris/app` ✅ **308 pass / 0 fail** (was 292) ·
`npm run build -w @polaris/app` ✅.

## Human verify / handoff
- Live notch rendering (real + demo fallback) needs a human on a real Mac — not verified; Horizon
  read covered by injected-fetch tests only.
- Typed `PromptPanel` turns are outside scope and not logged yet; follow-up: call the same `turnLog`
  API from `PromptPanel.submit`.
