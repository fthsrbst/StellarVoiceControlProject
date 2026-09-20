# Report: w5b-anchor-flows

- **Date:** 2026-09-20 · **Worker:** opencode worker (deepseek-v4.1-flash)
- **Branch/Worktree:** `feat/w5b-anchor-flows` / `.worktrees/w5b-anchor` · **PR:** none (uncommitted)

## Completed

1. **Anchor `Signer` + session factory** (`app/src/lib/anchor.ts`): `classifyAnchorTx` routes on the XDR sequence — `0` (SEP-10 challenge) → wallet-only `bridge_sign_challenge`; otherwise → the shared `runTx` pipeline (Touch ID + Freighter). Missing command is feature-detected (`AnchorSigningUnavailableError`). `createAnchorSession` wires the signer + explain log.
2. **Voice intents:** `IntentKind` gains `"withdraw"` (+ Rust mirror); `agent/src/tools/anchor.ts` (`deposit`/`withdraw`) turns "50 lira yatır" → `{deposit,TRY,50}` and "withdraw 5 USDC to TRY" → `{withdraw,USDC,5}`; registered in `runtime.ts`; `chain.ts` routes `withdraw` to `withdrawTry`.
3. **Anchor panel** (`AnchorPanel.tsx` + `panels/anchor/{steps,useAnchorFlow}.ts`): SEP-1 discovery, SEP-38 quote, step list with explain-log lines, deposit/withdraw forms (50–100 TRY / 1–100 USDC), mock-bank simulate + status poll, explorer link, error states, shared-treasury note, narration.
4. **Debug check** `app/src/debug/checks/anchor.ts`: SEP-1 discovery + SEP-10 endpoint present (network read only, never signs).

## Decisions

- The Signer's non-challenge branch runs `runTx` for the approval card + bridge but captures the submit instead of sending it: `AnchorSession` submits its own trustline/payment, so a second Horizon call would double-submit (covered by `anchor.test.ts`).
- **Scope extension:** `agent/src/runtime.ts` + `index.ts` (register/export the tools) and `app/src-tauri/src/types.rs` (`IntentKind::Withdraw`; `approval_begin` deserializes `Intent`, so a withdraw card would otherwise be rejected).

## Files touched

`interfaces/src/index.ts` · `app/src-tauri/src/types.rs` · `agent/src/{prompt,runtime,index,execution}.ts` + `tools/anchor{.ts,.test.ts}` · `app/src/lib/{anchor,anchor.test,chain}.ts` · `app/src/panels/AnchorPanel.tsx` · `app/src/panels/anchor/{steps.ts,steps.test.ts,useAnchorFlow.ts}` · `app/src/debug/checks/anchor.ts`.

## Verification

- `npm run check` (all workspaces) + `npm run build -w @polaris/app`: clean.
- `npm test -w @polaris/app`: **186 pass / 0 fail** (+13). `-w @polaris/agent`: **133 pass / 0 fail** (+7). `-w @polaris/stellar` anchor suite: 197 pass.
- `cargo test`: **225 passed / 0 failed / 5 ignored**; `cargo clippy -- -D warnings`: clean.

## Human-verify (not verified)

- Real Touch ID + Freighter for trustline/withdraw; SEP-10 login needs `bridge_sign_challenge` (W5a) merged, else it fails closed as "unknown". Tray Anchor… window, live anchor reachability, voice "50 lira yatır", narration audio.

## Blocked / handoff

- **W5a dependency:** `bridge_sign_challenge` is absent on this branch (feature-detected).
- Voice deposit/withdraw is multi-step; `executeApprovedIntent` runs only the first step — a full voice-driven journey is a later milestone (the panel drives the whole flow today).
