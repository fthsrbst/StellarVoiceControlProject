# backlog.md — Master Index of Unfinished Work

> This file is the **master index of all unfinished / handed-off work.**
> Every worker and sub-agent writes unfinished work as a detailed report in `backlog/<task-name>.md`
> and adds a single-line entry here. **Goal: never lose track of any task.**
> All entries and reports are written in **English**.
>
> Index row format:
> `| Date | Task | Worker/Agent | Status | Report | Priority |`

## Open Tasks

| Date | Task | Worker/Agent | Status | Report | Priority |
|---|---|---|---|---|---|
| 2026-09-19 | **A0 — harness**: global hotkey (press/release) + microphone capture to WAV + wire both into the existing log pane; delete the temporary `dev_self_test` command | Owner A | open | `backlog/2026-09-19-monorepo-skeleton.md` | P0 |
| 2026-09-19 | Owner B: fill in `stellar/` (anchor SEP-10/38/6 client, `sendPayment` tool) — stubs throw `NotImplementedError` today | Owner B | open | `backlog/2026-09-19-monorepo-skeleton.md` | P0 |
| 2026-09-19 | **TTS voice**: no professional Turkish voice on Fish Audio; decide spoken-output language. Also: expose a user-facing male/female voice choice (Sarah / Ethan) in a later milestone | Owner A | open | `backlog/2026-09-19-tts-voice-selection.md` | P1 |
| 2026-09-20 | **W3 — Touch ID approval gate**: independent-review fixes applied (WalletOnly webview bypass closed via in-process `begin_wallet_only`; W2 `{kind,message}` error contract + snapshot returns; panic-safe `in_flight` guard; F3–F7/F10/F11). Real Touch ID/password/cancel still need a human; **W5 must land the Rust anchor check before any WalletOnly release; W4b must not enable WalletOnly** | opencode-go/deepseek-v4.1-flash (L2, W3) | in review | `backlog/w3-touch-id-gate.md` | P0 |

## Completed Tasks (Archive)

| Date | Task | Worker/Agent | Closed By | Report |
|---|---|---|---|---|
| 2026-09-19 | Monorepo skeleton: `interfaces/`, `agent/`, `app/` (Tauri v2 + React), `stellar/`, `contracts/` (Soroban), tooling (`Makefile`, `scripts/`, `VERSION`, `CHANGELOG.md`) | coordinating agent (no workers, per user instruction) | pending PR review | `backlog/2026-09-19-monorepo-skeleton.md` |

---

## Sub-Report Template — `backlog/<task-name>.md`

```markdown
# Report: <task-name>
- **Date:** YYYY-MM-DD
- **Worker/Agent:** <name/model>
- **Branch/Worktree:** <branch>
- **PR:** <link or "none">

## Completed
- ...

## Unfinished (handed off)
- ...

## Blockers
- ...

## Review Notes
- ...

## Suggested Next Step
- ...
```
