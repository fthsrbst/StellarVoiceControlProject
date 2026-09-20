# Report: nw-rules
- 2026-09-20 · opencode worker (deepseek-v4.1-flash) · branch `feat/nw2-rules-page` · PR none.
- What: NW2 wires the notch Rules page to the real guard rules. `RulesPage.tsx`
  is now a read-only summary (mock toggles/Add-rule gone; editing stays in
  Security via "Edit rules in Security" → `openPanel("security")`).
- How: `notch/data/useRulesData.ts` = thin hook (one read per mount + Retry, no
  polling) + pure `mapRulesView(SecurityLoad)` reusing the Security panel's exact
  `stateLines` read-back, plus a `Saved contacts` line. States: `unconfigured`,
  `not_set_up` (rule null), `error`+Retry; a failed real read never becomes mock.
  Mock demo only outside Tauri / with no owner.
- Files: `notch/pages/RulesPage.tsx`, `notch/data/useRulesData.ts` (+`.test`, 6
  tests), `docs/notch-pages-wiring.md`, `backlog.md`, `sprints.md`.
- Decisions: read path only (`guardStateLive`/`guardState`); no new data source →
  no new Debug check; no value-moving code, no `POLARIS_ALLOW_AUTO_APPROVE`.
- Verify: `npm run check` pass; `npm test -w @polaris/app` 299/0 (was 293);
  `npm run build -w @polaris/app` built. Human: real notch panel, Security
  window, live testnet guard read.
- Blocked / handoff: none.
