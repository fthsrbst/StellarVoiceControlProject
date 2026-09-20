# Polaris UI panels

> Step W0. How the interactive panel windows work, how to add one, what the rules
> are, and how to run and verify them. Written for the frontend owner, who adds
> panels **without touching Rust**.

## 1. Why panels exist

The only window so far is the notch overlay (`app/src-tauri/src/notch.rs`): it is
transparent, click-through (`set_ignore_cursor_events(true)`), non-focusable and
always on top. That is exactly right for a HUD and exactly wrong for anything the
user must click: approval cards, wallet info, settings.

Panels are ordinary, on-demand, focusable windows. They reuse the overlay's
`index.html` — one bundle serves every window — and are selected by the **URL
hash**: Rust opens `index.html#/wallet`, and `app/src/main.tsx` reads the hash to
choose the component.

| Window | Label | Route | Size | Behaviour |
|---|---|---|---|---|
| (overlay) | `main` | no hash / `#/` | 780×120 (fixed) | transparent, click-through, non-focusable |
| Wallet | `panel-wallet` | `#/wallet` | 420×600 | normal window, resizable |
| Approval | `panel-approval` | `#/approval` | 440×520 | always on top, not resizable |
| Settings | `panel-settings` | `#/settings` | 520×600 | normal window, resizable |
| Debug | `panel-debug` | `#/debug` | 480×680 | normal window, resizable |

One instance per label: the first open builds the window, later opens show and
focus it. Closing a panel **hides** it (`panels::handle_window_event`) so its
webview — and any state in it — survives until the next open, and closing never
quits the app.

## 2. The Rust registry (`app/src-tauri/src/panels.rs`)

`PANELS` is a fixed allow-list of `PanelSpec`s (name, label, title, route,
width, height, always-on-top, resizable). Everything else derives from it:

- `open_panel(name)` — the Tauri command the webview calls. Unknown names come
  back as `PanelError::UnknownPanel { name }` (`{"kind":"unknownPanel",…}`);
  window failures as `PanelError::Window { message }`. It never panics.
- `panels::open(app, name)` — the Rust helper other modules use (the tray menu
  calls it for Wallet and Settings).
- `is_panel_label(label)` — recognises the `panel-*` namespace, which is also
  what the capability file targets and what the close handler checks.

Adding a panel on the Rust side is a new `PanelSpec` entry — nothing else. The
frontend must add the matching name to `panelRoutes.ts` in the same PR.

## 3. Tray menu

Polaris is an **accessory** app (no Dock icon, no app menu bar), so the menu-bar
status item is the only chrome. It is built in `lib.rs::setup_tray`:

- **Wallet…** → `panels::open(app, panels::WALLET)`
- **Settings…** → `panels::open(app, panels::SETTINGS)`
- **Debug…** → `panels::open(app, panels::DEBUG)` (the check registry and event
  tail; see `docs/debug-panel.md`)
- **Quit Polaris** → `app.exit(0)`

The approval panel is intentionally **not** in the tray: it is opened by the
approval flow, never by hand. The tray icon is the bundled app icon
(`tauri-build` embeds it), so there is no second asset to maintain.

## 4. Adding a panel

1. **Rust** (`app/src-tauri/src/panels.rs`): add a `PanelSpec` to `PANELS`.
   Keep the label `panel-<name>` (the capability glob and the close handler
   depend on it) and set `route: "#/<name>"`. Update the allow-list test.
2. **Route** (`app/src/panels/panelRoutes.ts`): add the name to `PanelName` and
   `PANEL_NAMES`. `parsePanelRoute` then recognises `#/<name>`; unknown hashes
   still fall back to the notch.
3. **Component** (`app/src/panels/<Name>Panel.tsx`): wrap the content in
   `PanelShell` (shared chrome) and use `Button` from
   `@/components/ui/button`. Wire it in `PanelRoot.tsx`.
4. Add tests for any new pure logic in `panelRoutes.test.ts`.

The Rust window is created before the webview loads, so the component only has
to render — there is no "panel not found" state.

## 5. Calling the shell from a panel

Two wrappers, both in `app/src/lib/`:

- **Events:** subscribe with the `usePolarisEvents` hook
  (`app/src/panels/events.ts`), which wraps `listenPolarisEvents` from
  `@/lib/polaris`. That helper owns the listener and the runtime guard
  (`isPolarisEvent`); the hook only owns mount/unmount. Pass a `useCallback`'d
  handler or the subscription is rebuilt every render.

  The typed union is `PolarisEvent` in `@polaris/interfaces` (mirrored by
  `app/src-tauri/src/events.rs`): `capture_status`, `transcript`,
  `agent_status`, `speech_status`, `approval_request`, `approval_result`,
  `tx_submitted`, `error`, …

- **Commands:** `openPanel(name)` from `@/lib/panels` opens another panel
  (`open_panel`). No other panel command exists yet; add new shared commands to
  `app/src/lib/` (never call `invoke` ad hoc from a component) so the Rust
  contract stays in one place. Debug-only commands are the one exception and are
  centralised in `app/src/debug/commands.ts` (`docs/debug-panel.md`).

## 6. Rules — do / don't

**Do**

- Keep panels presentation-only until their milestone lands. The skeletons are
  labelled with the milestone that fills them in.
- Take all shell access through `@/lib/polaris`, `@/lib/panels` and
  `@/panels/events`.
- Keep the hash grammar in `panelRoutes.ts` and the routes in Rust in step; both
  sides are tested.

**Don't**

- **Never call the chain from a panel.** Value-moving work goes through the
  single execution seam (`@/lib/chain.ts`) driven by the approval flow, not by a
  button in a window.
- **Never handle secrets.** No key, seed or API credential may reach a panel or
  any other webview. Signing is a Rust command behind Touch ID.
- **Never bypass the approval events.** The only approved path is
  `approval_request` → (user gesture) → `approval_result` → `tx_submitted`; a
  panel listens to those events, it does not invent its own.
- **Deny by default.** A new action must be fail-closed until a real gesture
  authorises it; never enable `POLARIS_ALLOW_AUTO_APPROVE`.

## 7. Running and verifying

```bash
make dev            # Tauri dev (Vite HMR); app/src-tauri/Cargo.toml already
                    # enables the `tray-icon` feature
npm run check -w @polaris/app
npm test -w @polaris/app
cargo test --manifest-path app/src-tauri/Cargo.toml
cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings
```

### Checklist

**Automated (covered by tests)**

- `parsePanelRoute` maps the four routes and falls back to the notch for
  unknown/malformed hashes (`app/src/panels/panelRoutes.test.ts`).
- The Rust registry is the four known panels, rejects unknown names with
  `PanelError::UnknownPanel`, and every spec has sane geometry, a `#/name`
  route and a `panel-*` label (`app/src-tauri/src/panels.rs`).
- `npm run check`, `npm test -w @polaris/app`, `npm run build -w @polaris/app`,
  `cargo test` and `cargo clippy -D warnings` are all green.

**Human on a real Mac (not verified by CI)**

- The menu-bar tray icon appears while the app runs and the app keeps **no** Dock
  icon (accessory policy unchanged).
- **Wallet…** in the tray opens a focusable window showing the Wallet panel; it
  can be typed in and clicked.
- Pressing **Close** hides the panel and the app stays alive; opening the panel
  again from the tray brings the **same** instance back.
- **Settings…** opens the Settings panel and the metadata it reads
  (`app_info`) is correct.
- The unknown-name path: calling `open_panel` with a bad name returns the
  `unknownPanel` error rather than opening a window.
