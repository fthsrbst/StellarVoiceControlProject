# Report: T1-defaults — send defaults, balance tool, more assets
- **Date:** 2026-09-20
- **Worker/Agent:** opencode worker (deepseek-v4.1-flash)
- **Branch/Worktree:** `feat/t1-asset-defaults` / `.worktrees/t1-defaults`
- **PR:** none (coordinator commits)

## Completed
- `send_payment` no longer defaults a missing asset to USDC: `parseSendPayment` rejects an omitted/blank asset ("asset is missing; ask which asset (XLM or USDC)"), `asset` is dropped from the JSON-schema `required`, and the prompt/tests were updated (`agent/src/tools/payment.ts` + `payment.test.ts`, `capabilities.ts`, `capabilities.test.ts`, `assets.test.ts`).
- New read-only `get_balance` (`agent/src/tools/balance.ts`): reads balances through an injected `ToolContext.readBalances`, builds a deterministic tr/en sentence ("You have 9,989 XLM.") and is registered in `createDefaultRegistry`, so the capability list picks it up.
- Spoken tool results: optional `AgentTool.toSpeech` + a small `loop.ts` branch speak the tool's sentence instead of raw JSON, with no second model turn. This is the one deviation from the listed scope (`loop.ts` is the only place that formats tool results).
- PGUSD registered in `stellar/src/payments/assets.ts` (`TESTNET_PGUSD_ISSUER`) with `assets.test.ts`; USDC/XLM entries unchanged.

## Verification
- `npm run check`: 4/4 workspaces pass.
- `npm test -w @polaris/agent` **179/179**; `-w @polaris/stellar` **961/961** (incl. 4 new); `-w @polaris/app` **268/268**.
- `node --env-file=…/.env scripts/e2e-prompt-eval.mjs`: **31/31 = 100%** (tools=9); no keys printed.
- Rust: not touched.

## Blocked / handoff
- Voice `send_payment` still allowlists only XLM/USDC (`agent/src/assets.ts`, out of scope), so "send 5 PGUSD" stays a clarification even though the chain registry accepts PGUSD.
- The live Horizon balance read + spoken sentence need a human (Tauri/mic/TTS); the tool is unit-tested with a fake reader.
