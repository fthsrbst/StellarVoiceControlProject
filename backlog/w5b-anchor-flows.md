# Report: w5b-anchor-flows

- **Date:** 2026-09-20 · **Worker:** opencode worker (deepseek-v4.1-flash)
- **Branch/Worktree:** `feat/w5b-anchor-flows` / `.worktrees/w5b-anchor` · **PR:** none (uncommitted)

## Completed

1. **Anchor `Signer` + session factory** (`app/src/lib/anchor.ts`): `classifyAnchorTx` routes on the XDR sequence — `0` (SEP-10 challenge) → wallet-only `bridge_sign_challenge`; otherwise → the shared `runTx` pipeline (Touch ID + Freighter). Missing command is feature-detected (`AnchorSigningUnavailableError`). `createAnchorSession` wires the signer + explain log.
2. **Voice intents:** `IntentKind` gains `"withdraw"` (+ Rust mirror); `agent/src/tools/anchor.ts` (`deposit`/`withdraw`) turns "50 lira yatır" → `{deposit,TRY,50}` and "withdraw 5 USDC to TRY" → `{withdraw,USDC,5}`; registered in `runtime.ts`; `chain.ts` routes `withdraw` to `withdrawTry`.
3. **Anchor panel** (`AnchorPanel.tsx` + `panels/anchor/{steps,useAnchorFlow}.ts`): SEP-1 discovery, SEP-38 quote, step list with explain-log lines, deposit/withdraw forms (50–100 TRY / 1–100 USDC), mock-bank simulate + status poll, explorer link, error states, shared-treasury note, narration.
4. **Debug check** `app/src/debug/checks/anchor.ts`: SEP-1 discovery + SEP-10 endpoint present (network read only, never signs).

## Decisions

- The Signer's non-challenge branch runs `runTx` for the approval card + bridge but captures the submit instead of sending it: `AnchorSession` submits its own trustline/payment, so a second Horizon call would double-submit. `anchor.test.ts` drives the real capture with a fake bridge (both the trustline and the payment envelope).
- **Scope extension:** `agent/src/runtime.ts` + `index.ts` (register/export the tools) and `app/src-tauri/src/types.rs` (`IntentKind::Withdraw`; `approval_begin` deserializes `Intent`, so a withdraw card would otherwise be rejected).

## Files touched

`interfaces/src/index.ts` · `app/src-tauri/src/types.rs` · `agent/src/{prompt,runtime,index,execution}.ts` + `tools/anchor{.ts,.test.ts}` · `app/src/lib/{anchor,anchor.test,chain}.ts` · `app/src/panels/AnchorPanel.tsx` · `app/src/panels/anchor/{steps.ts,steps.test.ts,useAnchorFlow.ts}` · `app/src/debug/checks/anchor.ts`.

## Verification

- `npm run check` (all workspaces) + `npm run build -w @polaris/app`: clean.
- `npm test -w @polaris/app`: **194 pass / 0 fail** (after the review fixes). `-w @polaris/agent`: **133 pass / 0 fail**. `-w @polaris/stellar` anchor suite: 197 pass (unchanged).
- Rust was not touched by the review fixes; `cargo test`/`clippy` were not re-run.

## Human-verify (not verified)

- Real Touch ID + Freighter for the trustline/withdraw and the real `bridge_sign_challenge` (W5a) round trip — the routing and the signed-XDR capture are unit-tested with a fake bridge, but the biometric/extension steps need a human. Tray Anchor… window, live anchor reachability, voice "50 lira yatır", narration audio.

## Blocked / handoff

- **W5a dependency (acceptance item):** `bridge_sign_challenge` is absent on this branch (feature-detected, fail closed). When W5a lands, **Rust must reject any XDR whose sequence is not 0**, so the wallet-only path can never sign a value-moving transaction.
- Voice deposit/withdraw now drives the whole `AnchorSession` flow (auth → prepare → start → pay) instead of one tool XDR; a deposit still stops at the anchor's bank instructions (the bank transfer is a human step) and has no `txHash`, so the notch does not announce it (App.tsx only speaks a submitted tx).

## Review fixes

- **B1:** `defaultSignViaPipeline` now assigns the signed XDR in the capture and hashes it with the session passphrase; tests drive the real function with a fake bridge for the trustline/payment success, denial, wallet-refusal and completed-without-envelope paths.
- **M1:** voice `deposit`/`withdraw` now run `runAnchorIntent` (auth → prepare → start → pay) on the panel's `AnchorSession`, so the seq-0 challenge goes to `bridge_sign_challenge` and value steps to `txPipeline`; the raw tool XDR is never pushed into `signAndSubmit`.
- **m1/m2/m3/NIT:** report claims corrected; the trustline step is marked done only when a trustline was added; `stepForExplain` maps `sep6.*` to waiting on a withdraw and no longer maps `horizon.*` to completed; `isMissingCommandError` is anchored to the whole command-not-found message; `anchorTxHash` uses the configured passphrase.
