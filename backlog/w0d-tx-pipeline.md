# Report W0d — shared approve → Touch ID → sign → submit pipeline

- **Date:** 2026-09-20
- **Worker/Agent:** opencode-go/deepseek-v4.1-flash
- **Branch/Worktree:** `feat/w0d-tx-pipeline` / `.worktrees/w0d-txpipeline`
- **PR:** none yet (coordinator commits)

## Done
- `app/src/lib/txPipeline.ts` — `runTx(result, {intent,label?}, deps?)` computes the seam's `xdrDigest`, asks the Touch ID approver, then `signAndSubmit`; never throws, returns `{status:"submitted",txHash,explorerUrl}` or fail-closed `{status:"denied"|"failed",label,detail}` (`label` = transaction label, `detail` = reason). `runTxSequence(steps, deps?, onProgress?)` runs strictly in order, stops at the first non-submitted step, reports `(index,total,label,phase)`. Deps (`approver`/`sign`/`now`) injectable; defaults lazily import `createTouchIdApprover`/`signAndSubmit` (same style as `chain.ts`).
- `app/src/lib/useTxRun.ts` — React hook + pure exported `txRunReducer` (`idle|running|done`, progress, outcomes, `run`/`reset`).
- Tests: `txPipeline.test.ts` (submitted, denied, approver throws, sign failure/throw, unsigned = failed, sequence stop + progress order, all-submitted), `useTxRun.test.ts` (reducer). Docs: `docs/ui-panels.md` §10.
- Verified: `npm run check` (all workspaces) clean; `npm test -w @polaris/app` **173 pass / 0 fail**; `npm run build -w @polaris/app` built OK (3 pre-existing ineffective-dynamic-import warnings).

## Remaining / handoff
- Not verified (needs a human + real Mac): actual Touch ID prompt, Freighter bridge and Horizon submission from a panel.
- Rust untouched; no core Cargo checks needed.
