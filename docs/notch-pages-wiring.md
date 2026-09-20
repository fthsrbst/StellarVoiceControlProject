# Wiring the notch pages to real data

The four notch panel pages (`app/src/notch/pages/**`) render `app/src/lib/mockData.ts`
only. Each page is presentational; wiring a page to real data means replacing its
mock array with a loader, not rewriting the markup. The page-routing seam stays as
is: `setNotchPage("history" | "tasks" | "rules" | "wallet")` from
`app/src/notch/notchPage.ts` (see `useNotchPage`) already accepts a voice intent.

| Page | File | Real source (already implemented) |
|---|---|---|
| History | `notch/pages/HistoryPage.tsx` | `lib/history.ts`: `fetchOwnerPayments` + `mapHistoryRecords` (→ `WalletTransaction`), plus the turn's transcript/response text. Map to `HistoryEntry`. |
| Tasks | `notch/pages/TasksPage.tsx` | `lib/schedulesLive.ts`: `loadUpcoming`; `lib/schedules.ts`: `toScheduleRows`, `keeperStatus` (mirror the `SchedulesPanel`). |
| Rules | `notch/pages/RulesPage.tsx` | `lib/guardStateLive.ts`: `loadSecurityState`; `lib/guardState.ts`: `stateLines`, `profileModeOf`, `ruleFromFields` (mirror `SecurityPanel`). |
| Wallet | `notch/pages/WalletPage.tsx` | `lib/stellarConfig.ts`: `getStellarConfig` (owner/network, `stellar_config`); `lib/history.ts`: `fetchOwnerAccount`/`fetchOwnerPayments`; `panels/wallet/walletModel.ts`: `deriveWalletView` (mirror `WalletPanel`). |

Notes:

- The existing panels are the reference implementations; reuse their loaders and
  models rather than calling Horizon directly from a notch page.
- Read-only first: Wallet/Rules/Tasks pages should render the loaded state. Any
  value-moving action must go through the shared seam (`executeApprovedIntent` /
  `runTx`), never a page-local call.
- No secrets, testnet only. Owner address and aliases come from `stellar_config`,
  never from the bundle.
