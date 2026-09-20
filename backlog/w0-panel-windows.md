# W0 — Interactive panel windows (UI infrastructure)

- **Task:** `TASK-W0.md`
- **Branch/worktree:** `feat/w0-panel-windows` in `.worktrees/w0-panels`
- **Worker:** opencode worker (`opencode-go/deepseek-v4.1-flash`)
- **Date:** 2026-09-20
- **Status:** on `feat/w0-panel-windows` (`6483025`, `b5a9a97`, `b2ce936`); the review corrections in §8 are applied but uncommitted in this worktree (coordinator commits); no PR opened

## 1. What was done

The shell had exactly one window — the transparent, click-through, non-focusable
notch overlay — so nothing interactive had anywhere to live. This step adds
on-demand, focusable panel windows plus a menu-bar tray that opens them, and a
pattern the frontend owner can extend without touching Rust.

### Rust panel registry — `app/src-tauri/src/panels.rs` (new)

- `PANELS`: a fixed allow-list of three `PanelSpec`s — `wallet` (`panel-wallet`,
  `#/wallet`, 420×600, normal), `approval` (`panel-approval`, `#/approval`,
  440×520, always-on-top), `settings` (`panel-settings`, `#/settings`, 520×600,
  normal).
- `open_spec` builds the window on first use with `WebviewWindowBuilder`, using
  the same `index.html` with the route in the URL hash; later calls only
  `show()` + `set_focus()`, so **one instance per label**. It builds hidden, then
  shows, so the window cannot flash at the wrong size before its webview paints.
- `resolve(name)` is the whole gate; unknown names return the typed
  `PanelError::UnknownPanel { name }` (serialized `{"kind":"unknownPanel",…}`)
  without ever touching a window.
- `open_panel` Tauri command (registered in `lib.rs`) and `open(app, name)` Rust
  helper (used by the tray).
- `handle_window_event` hides a panel on `CloseRequested` and calls
  `api.prevent_close()`, so closing dismisses the panel and never quits the app;
  the webview (and its state) survives for the next open.
- `is_panel_label` recognises the `panel-*` namespace used by the capability
  glob and the close handler.

### Tray — `app/src-tauri/src/lib.rs`

- `setup_tray` builds a menu-bar status item with **Wallet…**, **Settings…**,
  **Quit Polaris**. Wallet/Settings call the same `panels::open` helper as the
  command, so tray and frontend cannot drift; Quit calls `app.exit(0)`.
- Icon is the bundled app icon (`default_window_icon()`), so no second asset.
- Activation policy is unchanged (`Accessory`, `lib.rs::apply_activation_policy`)
  — no Dock icon, panels are ordinary focusable windows on top of the overlay
  app. The approval panel is deliberately absent from the tray.
- `tauri` now enables the `tray-icon` cargo feature (`Cargo.toml`); `Cargo.lock`
  was already resolved for it (no lock change).

### Capabilities — `app/src-tauri/capabilities/panels.json` (new)

`windows: ["panel-*"]` with `core:default` (covers the `polaris-event` listener
the panels use) plus `core:window:allow-close` (the PanelShell Close button).
App-defined commands (`open_panel`, `app_info`, …) are not ACL-gated, so no extra
command permission is needed.

### Frontend routing and panels — `app/src/`

- `main.tsx` reads `window.location.hash`; no hash / `#/` renders the existing
  notch `App` unchanged, a known panel hash renders `PanelRoot`.
- `panels/panelRoutes.ts`: pure `parsePanelRoute(hash)` → typed
  `{ kind: "notch" } | { kind: "panel"; panel: PanelName }`, tolerant of a
  missing `#`, leading/trailing slashes, a query string and case; any unknown
  hash falls back to the notch so a blank window is impossible.
- `panels/PanelShell.tsx`: shared chrome (header, title/subtitle, scrolling body,
  `polaris-*` dark palette, Close button) plus `PanelNote`.
- `panels/WalletPanel.tsx`, `ApprovalPanel.tsx`, `SettingsPanel.tsx`: clearly
  labelled skeletons that name their milestone, use `Button`, and subscribe to
  the existing typed stream through `panels/events.ts` → `@/lib/polaris`
  (`listenPolarisEvents`; no duplicated listener logic). Wallet shows the latest
  `tx_submitted`, Approval mirrors the latest `approval_request` summary
  (read-only), Settings reads `app_info` and the latest `error`.
- `panels/PanelRoot.tsx` maps the route union to components.
- `lib/panels.ts`: typed `openPanel(name)` wrapper over the `open_panel` command.
- `docs/ui-panels.md`: how the system works, how to add a panel, the event
  stream, do/don't (never call the chain from a panel, never handle secrets,
  never bypass approval events), and how to run/verify.

## 2. Decisions

- **Panels are normal decorated windows.** They get the native macOS title bar
  (and its close button), which is the expected desktop behaviour; the Rust close
  handler turns that close into a hide. No custom drag region was added, so no
  extra window permission is required.
- **Close = hide, not destroy.** One instance per label stays true and panel
  state survives; the overlay `main` window is never closed, so the app never
  exits on a panel close.
- **Tray lives in `lib.rs`, registry lives in `panels.rs`.** Keeps the window
  registry self-contained while app-level wiring stays in the composition root.
- **No `index.css` change.** `PanelShell` paints an opaque `bg-polaris-bg`; the
  existing transparent `#root` is fine because the panel shell fills it.
- **No auto-approve, no chain import.** Panels never call
  `@/lib/chain.ts`; the approval panel is presentation-only. Security invariants
  untouched.

## 3. Files touched

- `app/src-tauri/src/panels.rs` (new)
- `app/src-tauri/src/lib.rs` (module, command registration, `on_window_event`,
  tray setup)
- `app/src-tauri/Cargo.toml` (`tray-icon` feature)
- `app/src-tauri/capabilities/panels.json` (new)
- `app/src/main.tsx`, `app/src/lib/panels.ts` (new)
- `app/src/panels/{panelRoutes.ts,panelRoutes.test.ts,events.ts,PanelShell.tsx,PanelRoot.tsx,WalletPanel.tsx,ApprovalPanel.tsx,SettingsPanel.tsx}` (new)
- `docs/ui-panels.md` (new)
- `backlog/w0-panel-windows.md` (this file), `backlog.md`, `sprints.md`

Not touched (per scope): `notch.rs`, `App.tsx`, `turnSession.ts`, agent,
`interfaces/`, `stellar/`, `tauri.conf.json` (no config window needed — panels are
created at runtime).

## 4. Verification (real output)

Baseline before changes: `npm test -w @polaris/app` = 19 passed; `cargo test` =
123 passed / 5 ignored (per the A15 report).

```
$ npm run check                     # all workspaces (interfaces, agent,
                                    # stellar, app)
> tsc -p tsconfig.json              # each — clean

$ npm test -w @polaris/app
ℹ tests 25   ℹ pass 25   ℹ fail 0        (was 19; +6 parsePanelRoute tests)

$ npm run build -w @polaris/app
✓ 764 modules transformed.
✓ built in 548ms

$ cargo test --manifest-path app/src-tauri/Cargo.toml
test result: ok. 131 passed; 0 failed; 5 ignored   (was 123 / 5; +8 panel tests)

$ cargo clippy --manifest-path app/src-tauri/Cargo.toml --all-targets -- -D warnings
Finished `dev` profile ...             # clean

$ cargo check --manifest-path app/src-tauri/Cargo.toml
Finished `dev` profile ...             # clean
```

New Rust tests (all in `panels::tests`, none create a window):
`the_allow_list_is_exactly_the_three_known_panels`, `resolve_finds_known_panels`,
`resolve_rejects_unknown_names_without_touching_a_window`,
`every_spec_has_sane_geometry_and_a_route`,
`every_label_is_namespaced_and_recognised`,
`panel_url_carries_the_route_in_the_hash`,
`only_the_approval_panel_is_always_on_top`,
`panel_error_serializes_with_a_camel_case_kind`.

New frontend tests (`panelRoutes.test.ts`): no-hash is the notch; the three
known routes; trailing slashes / missing hash / query tolerated; case
insensitive; unknown → notch; `isPanelName` exactness.

## 5. Not verified — needs a human on a real Mac

CI cannot observe windows or the menu bar. The following are **not claimed** to
work:

- The menu-bar tray icon visually appears and Wallet…/Settings…/Quit are
  clickable.
- **Wallet…** opens a focusable, clickable window showing the Wallet panel.
- **Close** hides the panel and the app stays alive; reopening shows the same
  instance.
- **Settings…** opens the panel and `app_info` metadata is correct.
- `open_panel` with an unknown name returns the `unknownPanel` error in the
  running app (the pure `resolve` path is unit-tested; the command round-trip is
  not).
- The tray icon looks acceptable at menu-bar size (the bundled app icon is
  coloured, not a monochrome template).

## 6. Remaining work / handoff

- Populate the panel skeletons in their milestones (W1 wallet, W2 settings, W3
  approval/Touch ID); the approval panel stays read-only until signing lands.
- An admin/dev entry point to open the approval panel for testing (currently it
  has no UI trigger; only the command can open it).
- Consider a code-split so panel routes do not grow the overlay bundle (the build
  currently warns about a >500 kB chunk; pre-existing, not introduced here).
- Playwright/WebDriver UI tests for the tray flow when a test harness exists;
  today the window/tray layer is only human-verifiable.

## 7. Blockers

None.

## 8. Review fixes

Applied every MINOR and trivial NIT from `backlog/w0-panel-windows-review.md`
(nothing in the review blocked merge). Public names are unchanged, so the other
worktrees on this branch (`panels.rs` registry, `panelRoutes.ts`, `PanelShell`,
`lib/panels.ts`) are unaffected.

### What changed

- **Unhandled promise rejections (MINOR)** — `panels/WalletPanel.tsx:39` and
  `panels/PanelShell.tsx:33` now attach a `.catch` that logs a short
  `console.warn` and never throws, matching the existing `App.tsx` /
  `events.ts` / `polaris.ts` style. `void p` alone no longer leaves an
  unhandled rejection if the IPC call fails.
- **Duplicated `PanelName` unions (MINOR)** — `lib/panels.ts` now
  `import type { PanelName }` from `panels/panelRoutes.ts` and re-exports it
  (`export type { PanelName }`), so `panelRoutes.ts` is the single source of
  truth. The local union in `lib/panels.ts` is gone; the public export name is
  unchanged.
- **Failed `hide()` cancelled the close (MINOR)** — `panels.rs::handle_window_event`
  now calls `window.hide()` and only `api.prevent_close()` when it returned
  `Ok`. If the window server fails, the close proceeds and the window is rebuilt
  on the next open instead of leaving a visible, un-dismissable panel.
- **Create race spurious window error (MINOR)** — `panels.rs::open_spec` now
  matches the build error: a `WindowLabelAlreadyExists` /
  `WebviewLabelAlreadyExists` collision means another caller (tray vs.
  `open_panel`) built the same window first, so it focuses that window via the
  new `show_and_focus` helper and returns `Ok` instead of `PanelError::Window`.
  New pure test `a_label_collision_is_recognised_but_other_errors_are_not`.
- **Doc nits (NIT)** — `docs/ui-panels.md` §4 step 2 now states that
  `panelRoutes.ts` is the single source of truth and that `@/lib/panels`
  re-exports the union (must not redeclare it). This report's stale status line
  and module count were corrected (see §8.3 for the reproduced 764).

### Files touched in this round

- `app/src/panels/WalletPanel.tsx`, `app/src/panels/PanelShell.tsx`
- `app/src/lib/panels.ts`, `app/src/panels/panelRoutes.ts` (comment only)
- `app/src-tauri/src/panels.rs`
- `docs/ui-panels.md`, `backlog/w0-panel-windows.md`, `backlog.md`, `sprints.md`

### Verification (real output, re-run after the fixes)

```
$ npm run check
  @polaris/interfaces / @polaris/agent / @polaris/stellar / @polaris/app
  tsc -p tsconfig.json ................ clean (no diagnostics)

$ npm test -w @polaris/app
  ℹ tests 25   ℹ pass 25   ℹ fail 0

$ npm run build -w @polaris/app
  ✓ 764 modules transformed.
  ✓ built in 188ms
  (!) Some chunks are larger than 500 kB   # pre-existing, not introduced here

$ cargo test --manifest-path app/src-tauri/Cargo.toml
  test result: ok. 132 passed; 0 failed; 5 ignored; ... finished in 0.01s

$ cargo clippy --manifest-path app/src-tauri/Cargo.toml --all-targets -- -D warnings
  Finished `dev` profile [unoptimized + debuginfo] target(s) in 1.60s   # clean
```

Rust went from 131 to 132 tests (+1: the label-collision test); the app suite is
unchanged at 25 (the UI catches and the type de-duplication are not observable
without a DOM/window, so no new frontend test was warranted).

### Not verified (unchanged from §5)

The tray icon, focusable windows, close-hides-not-quits and reusing the same
instance are still human-only on a real Mac. The race fix and the hide-failure
fallback are also only unit/structurally verified — they cannot be exercised in
CI without real windows.

### Blocked / handoff

None. No files outside the W0 scope were touched.


