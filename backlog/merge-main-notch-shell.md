# MERGE-MAIN — merge origin/main notch shell into integration/wallet
Status: merged, verified, committed (merge commit `0233850`), not pushed.
## What / why
Merged Fatih's PR #23/#24 (notch shell, double-Control typed prompt, pages) into the
pipeline with one source of truth between his shell machine and our turn session.
## Conflicts + resolutions
- `App.tsx`: our turn-session pipeline (payment stages, watchdogs, done/error settle-once,
  pending-payment refusal, `onStage`, speech) rendered via his `ShellSurface`; App is the
  bridge (`visual`/`voiceState`/`voiceAttention` from `session`); hover/prompt shell-only.
- `lib.rs`: union re-exports (`ShellGeometry` + panels); dropped `NotchGeometry`/
  `NotchWindowFlags`; handler/tray keep all panels + shell commands. `backlog.md`: both sets.
- Debug check/commands used removed `getNotchGeometry`/`notch_window_flags`; ported to
  `getShellGeometry`. `notch.rs::window_size` ignored its shared width; fixed (BUG-1).
## Typed prompt (req c) + docs
`PromptPanel` runs `executeApprovedIntent` for a produced intent (same gate as voice).
`docs/notch-pages-wiring.md` maps each mock page to its real source.
## Verification
`npm run check` clean; app 292/0, agent 171/0, stellar 112/0; app build OK; `cargo test`
305/0 (5 ignored); `cargo clippy --all-targets -D warnings` clean. Fail-closed approval,
WalletOnly lock and `POLARIS_ALLOW_AUTO_APPROVE` untouched.
## Human-verify (not run)
Real notch hover/prompt/double-Control, Touch ID + Freighter, tray windows.
