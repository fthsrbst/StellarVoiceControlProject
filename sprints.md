# sprints.md — Milestone & Sprint Tracking

> Milestones and checklists live here. The coordinator reads this file when prioritizing tasks.
> Under each milestone, completion criteria (Definition of Done) are kept as a checklist.
> High quality in a short time frame: few milestones, clear criteria, frequent reviews.
> All entries are written in **English**.

---

## Milestone 0 — Project Infrastructure ✅
- [x] CLAUDE.md / AGENTS.md constitution
- [x] notes.md (idea memory)
- [x] backlog.md + backlog/ report system
- [x] docs/reports/ research archive
- [x] docs/model-ladder.md worker ladder
- [x] sprints.md milestone tracking

## Milestone 1 — Topic & Architecture Decision ✅
> Owner: research team — results land in `docs/reports/`.
- [x] Project topic finalized (2026-09-19: Polaris — see docs/architecture.md §1)
- [x] Technical architecture decision made (2026-09-19: docs/architecture.md, registered in docs/reports/INDEX.md)
- [x] Technology stack selected (2026-09-19: Tauri v2 + Rust core + React/TS/Vite + Tailwind + shadcn/ui)
- [ ] Repository skeleton created
- [ ] model-ladder.md model table filled in

## Milestone 2 — Vertical Slice 🔲
> Goal: voice → agent → one real testnet transaction. Deadline: today (hackathon crunch, ~6h blocks).
- [ ] docs/interfaces.md agreed by both owners (types: Intent, ChainTool, SigningService, PolarisEvent)
- [ ] Tauri spike: global hotkey + mic capture + Touch ID + Keychain read (Tauri vs Electron decision lands here)
- [ ] Repository skeleton: app/, agent/, stellar/, contracts/ + CI-less build scripts
- [ ] Voice pipeline: hotkey press/release → STT → agent loop → spoken/displayed answer
- [ ] Chain tool: "send 10 USDC to <alias>" returns unsigned XDR + decoded summary
- [ ] Touch ID approval card → signed XDR → testnet tx confirmed (SLICE COMPLETE)

## Milestone 3 — Chain & Guard 🔲
- [ ] polaris_guard Soroban contract: per-tx/daily spending limit + alias book; deployed on testnet, contract ID documented
- [ ] Anchor flow: SEP-10/38/6 TRY mock deposit → USDC balance, driven by voice
- [ ] Protocol integration: Soroswap swap OR DeFindex vault (pick ONE via testnet spike, do not attempt both)
- [ ] Approval card UI polished (Stellar Design System / shadcn), explorer links on card
- [ ] (optional if time) MPP pay-per-command session

## Milestone 4 — Delivery / Presentation 🔲
> Deadline: 20 Sep 12:00. Bonuses (passkey wallet, P2P escrow, developer mode) ONLY after M4 items are done.
- [ ] README refreshed to reflect current codebase (constitution requirement)
- [ ] Demo video recorded + pitch deck
- [ ] Docs synced: notes.md, backlog reports, docs/reports/INDEX.md, sprints.md all up to date
- [ ] (bonus, if everything above is done) passkey wallet / P2P escrow / developer mode

---

### Notes
- Each completed checklist item is marked with date + PR link: `[x] (2026-09-19, PR #12)`
- Milestone completion criteria: all checklist items ✅ + all PRs reviewed + no open backlog entries.
