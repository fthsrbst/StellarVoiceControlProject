# Review — W0 Interactive panel windows

- **Change under review:** `origin/main...HEAD` (`b2ce936`, `b5a9a97`, `6483025`) on branch `feat/w0-panel-windows`
- **Report reviewed:** `backlog/w0-panel-windows.md`
- **Reviewer:** independent L4 worker (did not write the code)
- **Date:** 2026-09-20
- **Verdict:** **APPROVE WITH CORRECTIONS** (all corrections MINOR/NIT; nothing blocks merge)

The implementation is small, self-contained and matches its report. The security
invariants are intact, the wire shapes are correct, tests are real, and I could
not produce a fail-open path or an app-quit-on-panel-close path. The corrections
below are quality/robustness items, not blockers.

---

## 1. Commands run (real output, exact counts)

```
$ npm run check
  @polaris/interfaces / @polaris/agent / @polaris/stellar / @polaris/app
  tsc -p tsconfig.json ................ clean (no diagnostics)

$ npm test -w @polaris/app
  ℹ tests 25   ℹ pass 25   ℹ fail 0

$ npm test -w @polaris/agent
  ℹ tests 109  ℹ pass 109  ℹ fail 0

$ npm test -w @polaris/stellar
  Test Files  12 passed (12)   Tests  112 passed (112)

$ npm run build -w @polaris/app
  ✓ 764 modules transformed.   ✓ built in 519ms
  (!) Some chunks are larger than 500 kB   # pre-existing, not introduced here

$ cargo test --manifest-path app/src-tauri/Cargo.toml
  test result: ok. 131 passed; 0 failed; 5 ignored; ... finished in 0.05s

$ cargo clippy --manifest-path app/src-tauri/Cargo.toml --all-targets -- -D warnings
  Finished `dev` profile [unoptimized + debuginfo] target(s) in 47.24s   # clean
```

All report claims reproduce. Two trivial deltas: the build reports **764**
transformed modules (report says 763) and the report's status line says the
changes are "uncommitted" while the branch already has three commits (expected
for this review, but the status line is stale). Both NIT.

---

## 2. What I verified as correct

- **Scope**: `git diff --name-only` shows only the files the brief allowed plus
  the necessary `main.tsx` entry-point glue and `lib.rs`/`Cargo.toml` wiring.
  `notch.rs`, `App.tsx`, `agent/`, `stellar/`, `interfaces/`, `tauri.conf.json`
  are untouched. No scope violation.
- **Wire shapes match**: `AppInfo.tauriVersion`, `approval_request.summary`
  (`title`/`lines`/`estimatedFee`), `tx_submitted.hash`, `error.message` all
  match `interfaces/src/index.ts`; `PanelError` serializes as
  `{"kind":"unknownPanel",...}` (`panel_error_serializes_...` passes).
- **Hash route reaches the webview**: Tauri 2.11.5 `prepare_webview` runs
  `Url::join("index.html#/wallet")` (only the exact string `"index.html"` is
  special-cased), so the fragment is preserved. `parsePanelRoute` cases all pass.
- **Events reach panels**: `events.rs::emit` uses `app.emit(...)`, which
  broadcasts to every window; panels listen through the existing
  `listenPolarisEvents`/`isPolarisEvent` seam (no second parser).
- **Capability scoping is real**: `capabilities/panels.json` targets `panel-*`;
  Tauri's authority matches window labels as `Pattern` globs (`authority.rs`),
  so dynamically created panels are covered. `core:default` predates this change
  on the `main` window and already covers `listen`; `core:window:allow-close` is
  needed and present for the `close()` the shell calls.
- **No panic / no fail-open in the command path**: `open_panel` only calls
  `resolve` then `open_spec`; the allow-list is exact and case-sensitive, unknown
  names never touch a window builder (`resolve_rejects_...`). No `unwrap` on
  user input. `POLARIS_ALLOW_AUTO_APPROVE` is untouched; no secret reaches a
  panel/webview; the approval panel is presentation-only.
- **Close cannot quit the app**: `handle_window_event` hides + `prevent_close`
  for `panel-*` labels only; the `main` window is never closed by this code and
  accessory apps do not terminate on last-window-close. `Quit Polaris` is the
  only exit and goes through `app.exit(0)`.
- **Tray lifetime**: I checked the "drop the `TrayIcon`" hazard — Tauri's
  `TrayIcon::register` stores a clone in the resources table, so dropping the
  `builder.build()?` value does **not** remove the icon. Not a bug.
- **The generated test suite has teeth**: Rust tests assert the allow-list,
  route/name coupling, label namespacing and exact JSON; the TS tests assert the
  fallback-to-notch and case-sensitivity. None are tautological.

---

## 3. Findings

### MINOR — unhandled promise rejections in the new UI handlers
- `app/src/panels/WalletPanel.tsx:39` — `onClick={() => void openPanel("settings")}`
- `app/src/panels/PanelShell.tsx:33` — `onClick={() => void getCurrentWindow().close()}`

`void p` does not attach a rejection handler. If `open_panel` or the window
`close` invoke rejects (ACL change, window already gone, IPC hiccup), the promise
rejection is unhandled and surfaces as an uncaught error rather than a logged
message. The rest of the codebase deliberately catches (`App.tsx:201,266`,
`polaris.ts::markTurnPhase` uses `.catch(() => {})`), so this is a deviation.
Suggested fix: `void openPanel("settings").catch((e) => console.warn(...))` and
the same for `close()`.

### MINOR — two independent `PanelName` unions on the frontend
- `app/src/lib/panels.ts:11` and `app/src/panels/panelRoutes.ts:13` both declare
  `export type PanelName = "wallet" | "approval" | "settings"`, and
  `panelRoutes.ts:15` adds a third list (`PANEL_NAMES`).

No runtime defect today (structural typing makes them compatible), but adding a
panel now requires editing *two* name lists, and the docs only mention
`panelRoutes.ts` (`docs/ui-panels.md` §4 step 2) — so the documented process is
incomplete and the lists can silently drift. Suggested fix: have `lib/panels.ts`
re-export/import `PanelName` from `panelRoutes.ts` (single source of truth) and
update the doc step.

### MINOR — a failed `hide()` still cancels the close
- `app/src-tauri/src/panels.rs:174` — `let _ = window.hide();` followed by
  `api.prevent_close();`

If `hide()` ever errors (unlikely), the close is still prevented and the window
stays visible and un-dismissable. Failure scenario: transient window-server
error → user cannot close the panel. Suggested fix: only `prevent_close()` when
`hide()` succeeded, or fall back to allowing the close (the label is reused and
the window is rebuilt on next open — the state-preservation is best-effort).

### MINOR — narrow create race surfaces a spurious window error
- `app/src-tauri/src/panels.rs:144-160` — check-then-`build`.

Two near-simultaneous opens (tray click on the main thread + `open_panel` on the
async runtime) can both observe `None` and both call `build`; Tauri returns
`WebviewLabelAlreadyExists` for the loser (`manager/webview.rs`), which becomes a
`PanelError::Window` shown/logged as a failure even though a window is opening.
No duplicate window and no panic, so this is acceptable; a retry-by-label after a
`build` error would make it invisible.

### NIT — report/doc nits
- `backlog/w0-panel-windows.md:7` says changes are "uncommitted" while the branch
  has three commits; `:125` says 763 modules (actual 764).
- `app/src/main.tsx` keeps the pre-existing missing trailing newline (report
  correctly does not claim to have changed it).

---

## 4. Explicitly not verified (needs a human on a real Mac)

Consistent with the report, I could not exercise: the tray icon appearing and its
menu items; Wallet…/Settings… opening focusable windows; the native close button
hiding (not destroying) a panel with the app staying alive and reusing the same
instance; `app_info` output in the Settings window; and whether an accessory
(`Accessory`) app reliably raises/focuses a newly shown panel over another app. I
traced the code paths and they are correct, but these remain human-verifiable
only.

## 5. Verdict

**APPROVE WITH CORRECTIONS.** The four MINOR items (rejection handling, the
duplicated `PanelName`, the unconditional `prevent_close`, the create race) and
the NITs should be addressed, ideally in this PR for the first two, but none blocks
merge: correctness, security invariants, tests and docs are otherwise sound.
