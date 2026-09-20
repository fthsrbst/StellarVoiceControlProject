# Report: W0c — register five more panels (skeletons only)
- **Date:** 2026-09-20 · **Worker:** opencode worker (deepseek-v4.1-flash) · **Branch:** `feat/w0c-more-panels`

## Completed
Registered `security`, `schedules`, `suggestions`, `anchor`, `p2p` (460×640, resizable) in
`panels.rs` (+tests); union/routes in `panelRoutes.ts` (+tests) and cases in
`PanelRoot.tsx`; one `PanelShell` skeleton each; tray reworked in `lib.rs` to Wallet /
Security & rules / Schedules / Suggestions / Anchor / P2P / Settings / Debug / Quit;
`docs/ui-panels.md` table, tray list and checklist updated.

## Decisions
Tray ids are the panel names (`TRAY_MENU_PANELS`), so tray and `open_panel` share one
allow-list; approval stays out of the tray. Skeleton notes name the filling milestone
(M3 for security/schedules/suggestions/anchor, M4 bonus for p2p).

## Tests
`npm run check` green; `npm test -w @polaris/app` 159/0; `npm run build -w @polaris/app`
3.20s; `cargo test` 225 passed/0 failed/5 ignored; `cargo clippy -D warnings` clean.

## Remaining / human-verify
Tray icon, new windows opening/focusing, close-keeps-app-alive — not verified (needs a Mac).

## Blocked / handoff
`capabilities/panels.json` comment still lists old labels (out of scope; `panel-*` glob covers them).
