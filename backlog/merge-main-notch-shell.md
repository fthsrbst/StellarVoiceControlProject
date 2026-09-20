# MERGE-MAIN — merge origin/main notch shell into integration/wallet

Status: merged, verified, committed (merge commit `0233850`, not pushed).

## What / why
Merged Fatih's PR #23/#24 (notch shell, double-Control typed prompt, pages) into
the pipeline branch with one source of truth between his shell machine and our
turn session.

## Conflicts + resolutions
- `App.tsx`: kept our turn-session pipeline (payment stages, per-stage + 6 min
  watchdogs, done/error settle-once, pending-payment refusal, `onStage`,
  submitted/failure speech), rendered via his `ShellSurface`. App is the bridge:
  `visual`/`voiceState`/`voiceAttention` derive from `session`; hover/prompt stay
  shell-only sources.
- `lib.rs`: unioned re-exports (`ShellGeometry` + `PanelError/PanelSpec/PANELS`);
  dropped obsolete `NotchGeometry`/`NotchWindowFlags`; handler/tray keep all
  panels plus his shell commands.
- `backlog.md`: kept both append sets.
- Auto-merge casualties: Debug check/commands used the removed
  `getNotchGeometry`/`notch_window_flags`; ported to `getShellGeometry`.
- `notch.rs::window_size` ignored its shared `window_width`; fixed to the
  documented fixed width (BUG-1) so origin's own test passes.

## Typed prompt (req c) + docs
`PromptPanel` runs `executeApprovedIntent` for a produced intent (same
approve → sign → submit gate as voice). `docs/notch-pages-wiring.md` maps each
mock page to its real source.

## Verification
`npm run check` clean; app 292/0, agent 171/0, stellar 112/0; app build OK;
`cargo test` 305/0 (5 ignored); `cargo clippy --all-targets -D warnings` clean.
Fail-closed approval, WalletOnly lock and `POLARIS_ALLOW_AUTO_APPROVE` untouched.

## Human-verify (not run)
Real notch hover/prompt/double-Control, Touch ID + Freighter, tray windows.
