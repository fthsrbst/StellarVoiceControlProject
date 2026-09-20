# Report: T1 settings / env / Makefile
- **Date:** 2026-09-20 · **Worker:** opencode worker (deepseek-v4.1-flash)
- **Branch/Worktree:** `feat/t1-settings-env` / `.worktrees/t1-settings` · **PR:** none (coordinator commits)

## Completed
- **Settings panel** (`SettingsPanel.tsx` + `panels/settings/{settingsModel.ts,StatusBadge.tsx,settingsModel.test.ts}`): read-only rows (app/STT/TTS/agent/credentials/Stellar/bridge) with ok/warn/fail/unknown badges + the `.env` variable to change each; redacted "Copy diagnostics"; no secret value and no editor.
- **Debug check** `debug/checks/settings.ts`: reads `voice_health` + `stellar_config`; non-testnet = fail, missing owner/key = warn.
- **`.env` discovery** (`src-tauri/src/env.rs`): walk-up `.env`, else `~/Library/Application Support/Polaris/.env`; real env vars still win; path-only log; +3 tests.
- **Makefile / `.env.example`**: `build` uses `$HOME/.cargo/bin` + the local `npm run tauri:build`; new `run` launches the bundle binary from the repo root so the repo `.env` is found; header documents discovery.

## Tests (green)
- `npm run check`: pass · `npm test -w @polaris/app`: **279 pass / 0 fail** · `npm run build -w @polaris/app`: built.
- `cargo test`: **272 pass / 0 fail / 5 ignored** (`env::` 8/8) · `cargo clippy -D warnings`: clean · `make build`: `Polaris.app` bundled (executable `polaris-app`).

## Decisions / handoff
- STT language / allowed-languages / TTS voice are not reported by `voice_health` yet; those rows stay `unknown` until that command's owning milestone exposes them (no out-of-scope edit).
- **Out-of-scope base-sync:** `bridge/commands.rs` test helper lacked the W5a `challenge` field (this base predates upstream fix `2a56501`); applied the identical 2-line fix so `cargo test` compiles — flag for the coordinator.
- Human-verify: tray/panel window, Copy-diagnostics clipboard, `make run`, Finder-launch `.env` fallback.
