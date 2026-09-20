# Report: T1-demo — demo script, pitch, README status (docs only)

- **Date:** 2026-09-20 · **Worker:** opencode worker (deepseek-v4.1-flash) · **Branch:** `docs/t1-demo-script` (worktree `.worktrees/t1-demo-docs`) · **PR:** none
- **Done:** `docs/demo-script.md` (63 lines) — 3–4 min live script with exact spoken lines, panels, fallbacks, pre-flight; `docs/pitch.md` (51 lines) — problem/solution/why-Stellar/architecture/security/live-vs-designed/roadmap; `README.md` status sections refreshed (32 changed lines: header, "App, panels and Debug panel", Wired/Not-wired). All claims trace to repo files.
- **Decisions:** `docs/wallet-track.md` does **not** exist on `integration/wallet` (only on `docs/wallet-track-plan`), so the public acc1/acc2 addresses are stated inline and sourced from `backlog/w1-network-wiring.md` / `backlog/w4a-freighter-bridge-page.md`. There is **no `make run` target** (Makefile has `make setup`/`make dev`), so the docs use the real command.
- **Tests:** docs-only; no `npm run check` / tests affected. `wc -l` verified: demo-script 63 ≤ 80, pitch 51 ≤ 60. README diff 14+/18−.
- **Human-verify (marked `[verify live]`):** mic + STT, Touch ID, Freighter round trip, real panel windows, P2P contract, anchor payout.
- **Blocked / handoff:** none. Did not touch `docs/wallet-track.md` (out of scope / not on this branch); coordinator may merge the wallet-track plan and re-check the address reference.
