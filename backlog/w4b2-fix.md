# Report: W4b2-fix — apply the W4b-2 wiring review

- **Date:** 2026-09-20 · **Worker:** opencode worker (deepseek-v4.1-flash)
- **Branch:** `fix/w4b2-review` in `.worktrees/w4b2-fix` (from `integration/wallet`, base `6db6350`) · **PR:** none

The review predated the F1/W5/W6 merges, so MAJOR-1 was partly fixed already and MAJOR-2
is blocked by out-of-scope modules.

## Changes

- **MAJOR-1** `turnSession.ts`: added `shouldSurfaceOutcome(session, turnId, submitted)` —
  a submitted tx is always surfaced even after a watchdog settled the turn as failed;
  `App.tsx` uses it. Confirmed F1 swaps the `thinking` watchdog (30 s) for
  `APPROVAL_WATCHDOG_MS` (140 s) at `awaiting_approval`, so a 90 s approval cannot trip.
- **MAJOR-2** `signing.ts`: `@polaris/stellar` is now a type-only import plus a lazy
  `await import(...)` in `defaultSigningDeps.submit`; `explorerTxUrl` injectable via
  `SigningDeps`. `debug/checks/{submit,network}.ts` import it inside `run()`.
- **MINOR-1** `isBridgeSigned` requires string `signedXdr`/`txHash`; a malformed success is
  a labelled "Signing error", never a throw.
- **MINOR-2/3/NIT** corrected the `tx_submitted_emit` docs (shape check, not proof) and
  labelled the `WalletPanel` hash "reported by the app"; refreshed stale
  `chain.ts`/`speech.ts` comments; `approver.ts` arms the wait before opening the card and
  opens it fire-and-forget, so a hanging `open` is bounded.

**Files:** `app/src/lib/{turnSession,approver,signing,chain}.ts` (+ tests), `app/src/App.tsx`
(2 lines), `app/src/debug/checks/{submit,network}.ts`, `app/src/panels/WalletPanel.tsx`,
`app/src-tauri/src/tx_events.rs` (docs), `agent/src/speech.ts` (comments), `backlog.md`,
`backlog/w4b-wiring.md`, `sprints.md`.

## Test output (real)

```
npm run check                 -> clean (interfaces/agent/stellar/app)
npm test -w @polaris/app      -> tests 275  pass 275  fail 0
npm test -w @polaris/agent    -> tests 171  pass 171  fail 0
npm run build -w @polaris/app -> built
cargo check / cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings -> clean
```

New: `shouldSurfaceOutcome` + 90 s approval ceiling; 90 s approval + hanging-`open` deadline;
malformed `isBridgeSigned` + labelled failure + injected explorer URL.

## MAJOR-2 — before / after bundle

Both builds `modulepreload` `esm-*.js` (838 kB, the Stellar SDK): before `main-DCRHurpD.js`
(590.20 kB), after `main-BuoAhRrN.js` (591.51 kB). The W4b-2 static imports are gone, but
the SDK stays eager because later W5/W6 modules statically import the chain package from
panels and the eager Debug checks.

## Blocked / handoff

- **MAJOR-2 goal unmet at this base.** Fully dropping the SDK needs the Debug checks
  (`debug/registry.ts` eager glob) and panels (`PanelRoot`/`main.tsx`) lazy-loaded. Eager
  static importers: `debug/checks/anchor.ts`, `lib/anchor.ts`, `lib/guardState*.ts`,
  `lib/history.ts`, `lib/schedulesLive.ts`, `lib/spp.ts`, `panels/{anchor,schedules,
  suggestions}/*` — all out of scope.
- **`App.tsx` edited** (2 lines, out of scope): the guard is the only place the
  never-drop-a-submitted-tx path can live.
- **Base is behind `integration/wallet`**: `cargo test` fails to compile the pre-existing
  `bridge/commands.rs` test helper (missing `challenge`), fixed there by `2a56501`; the Rust
  change is doc-only and `cargo check`/`clippy` are green.

## Not verified (needs a human)

Touch ID prompt, the approval card, real Freighter signing, a live testnet payment.
