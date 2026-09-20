# MERGE-MAIN — merge origin/main notch shell into integration/wallet

Status: merged, verified, committed (merge commit, not pushed).

## What / why
Merged Fatih's PR #23/#24 (expandable notch shell, double-Control typed prompt,
multi-page surface) into the real pipeline branch, with one source of truth
between his shell machine and our turn session.

## Conflicts + resolutions
- `app/src/App.tsx`: kept our turn-session pipeline (payment stages, per-stage +
  6 min watchdogs, done/error settle-once, pending-payment refusal, `onStage`,
  submitted/failure speech); replaced our inline markup/geometry with his
  `ShellSurface` API. App is now the bridge: `visual`/`voiceState`/`voiceAttention`
  are derived from `session`; hover/prompt stay shell-only sources.
- `lib.rs`: unioned the re-exports (`ShellGeometry` + `PanelError/PanelSpec/PANELS`);
  dropped obsolete `NotchGeometry`/`NotchWindowFlags` (origin renamed/removed).
  Handler/tray keep all our panels plus his shell commands.
- `backlog.md`: kept both append sets.
- Auto-merge casualties: `debug/{checks/notch.ts,commands.ts}` used the removed
  `getNotchGeometry`/`notch_window_flags`; ported to `getShellGeometry`.
- `notch.rs::window_size` ignored its shared `window_width`, so origin's own test
  `every_state_shares_one_centred_window_column` was red; fixed to the documented
  fixed width (BUG-1 invariant).

## Typed prompt (req c)
`PromptPanel` now runs `executeApprovedIntent` for a produced intent (same
approve → sign → submit gate as voice), showing the real stage/hash/failure.
`docs/notch-pages-wiring.md` maps each mock page to its real source.

## Verification
`npm run check` clean; app 292/0, agent 171/0, stellar 112/0; app build OK;
`cargo test` 305 pass / 0 fail / 5 ignored; `cargo clippy --all-targets -D warnings`
clean. Fail-closed approval, WalletOnly webview lock and
`POLARIS_ALLOW_AUTO_APPROVE` untouched.

## Human-verify (not run)
Real notch hover/prompt/double-Control, Touch ID + Freighter round trip, tray
windows. Pages stay mock by request (seams documented).
