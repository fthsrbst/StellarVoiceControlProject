# W0b — Debug panel + FeatureCheck registry

**Branch:** `feat/w0b-debug-panel` (worktree `.worktrees/w0b-debug`)
**Status:** complete, uncommitted (coordinator commits).
**Scope:** `app/src/debug/**`, `app/src/panels/{DebugPanel.tsx,PanelRoot.tsx,panelRoutes.ts,panelRoutes.test.ts}`,
`app/src-tauri/src/{panels.rs,voice_health.rs,lib.rs}`, `docs/{ui-panels.md,debug-panel.md`.
`backlog.md`/`sprints.md` deliberately untouched (docs worker owns them).

## What was done

### Panel registration (item 1)
- `app/src-tauri/src/panels.rs`: added `DEBUG = "debug"` and a `PanelSpec`
  (`panel-debug`, `#/debug`, 480×680, normal, resizable). Updated the allow-list
  tests from three to four panels.
- `app/src-tauri/src/lib.rs`: tray item **Debug…** wired to `panels::open(app, panels::DEBUG)`.
- `app/src/panels/panelRoutes.ts` + `.test.ts`: `"debug"` added to `PanelName`,
  `PANEL_NAMES` and the route tests.
- `app/src/panels/PanelRoot.tsx`: routes `debug` to `DebugPanel`.
- `docs/ui-panels.md`: Debug row, tray list, four-panel wording, debug-only
  command note.

### Registry (item 2) — `app/src/debug/`
- `types.ts`: `CheckStatus`, `CheckResult`, `CheckAction`, `FeatureCheck`
  (`milestone` typed `` `W${number}` ``).
- `registry.ts`: pure `collectChecks(modules)` (ordering by milestone then id,
  malformed module → failing `malformed:<path>` entry) + `loadChecks()` which owns
  the `import.meta.glob("./checks/*.ts", { eager: true })`. The glob is inside the
  function so the collector is testable under plain `node`.
- `runner.ts`: `runCheck` (5 s default timeout, throw/reject/timeout →
  `fail`, normalises and redacts every result, swallows late rejections after a
  timeout) and `runAll` (bounded concurrency, input-order results).
- `redact.ts`: ordered matcher for `gsk_…`, `sk-…`, 56-char Stellar seeds
  (`S…`) and ≥40-char base64/hex blobs → `[redacted]`; **preserves** 56-char
  Stellar public keys (`G…`).
- `eventTail.ts`: last-50 ring + `lastEvent(type)`.
- `commands.ts`: typed wrappers for the debug-only commands
  (`notch_window_flags`, `voice_health`, feature-detected `stellar_config`).

### Baseline checks + Rust `voice_health` (items 3)
- `checks/app.ts` (`app_info`), `checks/capture.ts` (`capture_status`),
  `checks/notch.ts` (`notch_geometry` + `notch_window_flags`),
  `checks/hotkey.ts` (last `hotkey_permission` event or `unknown`),
  `checks/voice.ts` (maps `voice_health` to a single status).
- `app/src-tauri/src/voice_health.rs`: `health(read)` reads only presence via an
  injected env reader; `voice_health` command uses the live `env::var`. Reports
  `sttBackend`/`ttsBackend`/`agentProvider` (through the pipeline's own parsers)
  and `groqKey`/`fishKey`/`anthropicKey`/`openaiCompatKey` booleans. Registered
  in `lib.rs` (`mod voice_health;` + handler line). **`commands.rs` was not
  modified** — see Decisions.

### Debug panel UI (item 4)
`app/src/panels/DebugPanel.tsx`: header (version, network, owner when
`stellar_config` exists), checks list with badge (colour + text), title,
milestone tag, one-line detail, last-checked time, per-check **Run**, plus
**Run all**, auto-run once on open, per-check `actions` as secondary buttons
(none ship yet), live 50-event tail (type + redacted payload), and **Copy
report** (app info + all results + last 20 events, redacted) via the clipboard.

### Docs (item 5)
`docs/debug-panel.md`: the contract, a 15-line example, status rules, actions,
what never goes in `detail`, the file map and verification.

## Files touched
- New: `app/src-tauri/src/voice_health.rs`, `app/src/debug/**` (types, registry,
  runner, redact, eventTail, commands, 5 checks, 5 tests), `app/src/panels/DebugPanel.tsx`,
  `docs/debug-panel.md`, this report.
- Modified: `app/src-tauri/src/panels.rs`, `app/src-tauri/src/lib.rs`,
  `app/src/panels/{PanelRoot.tsx,panelRoutes.ts,panelRoutes.test.ts}`,
  `docs/ui-panels.md`.

## Decisions
- **`commands.rs` untouched.** The command is registered where Tauri's
  `invoke_handler` actually lives (`lib.rs`): `mod voice_health;` + one handler
  line. Adding a `pub use` to `commands.rs` would have been an unused re-export.
- **`voice_health` returns raw non-secret facts; `checks/voice.ts` maps them.**
  This matches task item 3 (the mapping lives in TS) and keeps a copy change out
  of the Rust build. The Debug contract's "Rust `health` + `<feature>_health`"
  is satisfied by `voice_health::health` + the `voice_health` command.
- **Hotkey check reads the event tail, not the command.** Per the task, it
  reports `unknown` with "hold Control+Option once" until a real event proves the
  gesture was exercised; `getHotkeyPermission` would report trust without that
  proof.
- **Debug-only commands live in `app/src/debug/commands.ts`,** since
  `app/src/lib/panels.ts` was outside the file scope; the existing "no ad-hoc
  `invoke` in components" rule is still honoured (all `invoke` calls are in one
  wrapper module).
- **`lib/panels.ts` was left unchanged** (out of scope): its `PanelName` union is
  only used by `openPanel`, and nothing webview-side needs to open Debug — the
  tray and `#/debug` route do.

## Verification (real output)

```
$ npm run check -w @polaris/app        # tsc: clean (no output)
$ npm run check                        # all workspaces: clean
$ npm test -w @polaris/app
  ℹ tests 53   ℹ pass 53   ℹ fail 0   ℹ skipped 0
$ npm run build -w @polaris/app
  ✓ 775 modules transformed. ✓ built in 408ms
$ cargo test --manifest-path app/src-tauri/Cargo.toml
  test result: ok. 135 passed; 0 failed; 5 ignored
$ cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings
  Finished `dev` profile ... (no warnings)
```

New automated coverage: `runner.test.ts` (ok / sync-throw / reject / timeout /
malformed / redaction / isolation / order / concurrency bound / actions never
auto-run), `registry.test.ts` (ordering, numeric W10>W3, malformed tolerance),
`redact.test.ts` (each secret shape + public-key non-false-positive),
`eventTail.test.ts`, `hotkey.test.ts`, `panelRoutes.test.ts` (`#/debug`), and 4
`voice_health` Rust tests including *serialized output never contains a key
value*.

## Remaining work / human verification (not verifiable by CI)
- Tray **Debug…** opens the panel; badges render with colour **and** text.
- **Copy report** writes redacted JSON to the clipboard (`navigator.clipboard`
  in the real webview).
- The event tail fills while using the push-to-talk gesture; transcript text is
  visible and redacted.
- `stellar_config` is absent on this branch, so the owner row is hidden;
  `getStellarConfigIfAvailable` will surface it once that command lands.
- Real `voice_health` values depend on the local `.env` (not exercised; the
  mapping is unit-tested with an injected reader by design).

## Blocked / handoff
- None blocking.
- Handoff: another milestone adding a check only needs one new
  `app/src/debug/checks/<feature>.ts` (contract in `docs/debug-panel.md`).
  `app/src/lib/panels.ts` will need `"debug"` added if a webview ever needs to
  open the Debug panel via `openPanel`.
