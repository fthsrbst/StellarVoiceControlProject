# Report: nw-wallet — Notch Wallet page on real data
- **Date:** 2026-09-20 · **Worker:** opencode worker (deepseek-v4.1-flash)
- **Branch:** `feat/nw1-wallet-page` / `.worktrees/nw1-wallet` · **PR:** none (uncommitted)

## Completed
- `app/src/notch/data/useWalletData.ts`: thin hook over `stellar_config` + `lib/history.ts` (`fetchOwnerAccount`/`fetchOwnerPayments`, `buildAliasEntries`, `mapWalletTransactions`); pure `deriveWalletPageView` yields owner/explorer, network, balances, alias book, last 5 payments with explorer links, loading/unconfigured/offline/unfunded(+Friendbot) states, and the session's `tx_submitted` (`listenPolarisEvents`) as "Latest transaction". Read-only; manual Refresh; no value movement. 8 pure tests in `useWalletData.test.ts`.
- `app/src/notch/pages/WalletPage.tsx`: data source swapped to the hook; layout/classes unchanged, new states reuse existing `wallet-*`/`page-*` classes (no CSS); only `mockData` left for two formatting helpers.

## Decisions
- No mock fallback: the reference `WalletPanel` shows an explicit unconfigured message, not fake balances (fake funds would mislead); `mockData.ts` untouched.
- No new Debug check (same sources as the W6 `wallet` check); reused `walletModel.shortAddress`.

## Verification
- `npm run check` clean; `npm test -w @polaris/app` **301 pass / 0 fail**; `npm run build -w @polaris/app` green.

## Blocked / handoff
- Human on the real notch: copy, explorer links and a live `tx_submitted` row need a funded testnet owner + real submission. No Rust touched.
- Refresh-on-panel-open is not wired (the always-mounted page has no visibility prop; `NotchPanel.tsx` is out of scope). Load happens on mount + manual Refresh.
