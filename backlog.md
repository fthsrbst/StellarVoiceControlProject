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
| 2026-09-20 | **W1 — network wiring**: `stellar_config` command + `StellarConfig`, build-then-approve execution seam (summary + `payloadHash`), lazy `chain.ts` config with alias merge, live `e2e:build-xdr` proof; signing/submission handed off | worker (deepseek-v4.1-flash) | open (review) | `backlog/w1-network-wiring.md` | P0 |
| 2026-09-20 | **W1-fix — review corrections**: `xdrDigest` vs Stellar tx hash disambiguation + cross-suite regression test, malformed tool result fails closed, `executeIntent` never-throw holes closed, StrKey CRC16 checksum, SHA-256 multi-block/UTF-8 vectors, stale-doc fixes | worker (deepseek-v4.1-flash) | open (review) | `backlog/w1-network-wiring.md` | P0 |
| 2026-09-19 | **A0 — harness**: global hotkey (press/release) + microphone capture to WAV + wire both into the existing log pane; delete the temporary `dev_self_test` command | Owner A | open | `backlog/2026-09-19-monorepo-skeleton.md` | P0 |
| 2026-09-19 | Owner B: fill in `stellar/` (anchor SEP-10/38/6 client, `sendPayment` tool) — stubs throw `NotImplementedError` today | Owner B | open | `backlog/2026-09-19-monorepo-skeleton.md` | P0 |
| 2026-09-19 | **TTS voice**: no professional Turkish voice on Fish Audio; decide spoken-output language. Also: expose a user-facing male/female voice choice (Sarah / Ethan) in a later milestone | Owner A | open | `backlog/2026-09-19-tts-voice-selection.md` | P1 |
| 2026-09-20 | **W0 — Interactive panel windows**: Rust panel registry + `open_panel` command, menu-bar tray (Wallet… / Settings… / Quit), `panel-*` capability, hash routing + panel skeletons; review corrections applied (§8 of the report), tray/window behaviour still needs a human on a real Mac | Owner A (worker) | open | `backlog/w0-panel-windows.md` | P0 |
| 2026-09-20 | **W3 — Touch ID approval gate**: independent-review fixes applied (WalletOnly webview bypass closed via in-process `begin_wallet_only`; W2 `{kind,message}` error contract + snapshot returns; panic-safe `in_flight` guard; F3–F7/F10/F11). Real Touch ID/password/cancel still need a human; **W5 must land the Rust anchor check before any WalletOnly release; W4b must not enable WalletOnly** | opencode-go/deepseek-v4.1-flash (L2, W3) | in review | `backlog/w3-touch-id-gate.md` | P0 |
| 2026-09-20 | **W4a — Freighter signing bridge page** (Stellar Wallets Kit): `/sign` second Vite entry, pure state machine, fail-closed address/network checks, signed-vs-unsigned hash binding, local fixture + tests, protocol docs; review fixes 2 applied | opencode worker (deepseek-v4.1-flash) | in review (fixes applied) | `backlog/w4a-freighter-bridge-page.md` | P0 |
| 2026-09-20 | **W4b-1 — Rust bridge server + independent signature verification**: one-shot loopback `tiny_http` session (one-time token, TTL, const-time compare, Host/Origin/CSP caps), `bridge_sign`/`bridge_selftest`/`bridge_health`, parse-free XDR verification + in-repo StrKey, browser launcher; real browser + Freighter round trip still needs a human | opencode worker (deepseek-v4.1-flash) | open (review) | `backlog/w4b-bridge-server.md` | P0 |

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
