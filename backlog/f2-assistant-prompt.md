# Report: F2 — real assistant system prompt
- **Date:** 2026-09-20
- **Worker/Agent:** opencode worker (deepseek-v4.1-flash)
- **Branch/Worktree:** `fix/f2-assistant-prompt` / `.worktrees/f2-assistant-prompt`
- **PR:** none (coordinator commits)

## Completed
- `agent/src/capabilities.ts`: `buildSystemPrompt()` composes role/behaviour, a **capability list generated from the live tool registry**, an explicit "cannot" list, the config **account table** (owner `acc1` + aliases with short addresses), asset/number rules and 12 few-shot examples (tr/en, garbled STT, positives + negatives incl. the owner sentence and sending FROM `acc2` refused).
- `agent/src/accountRefs.ts`: pure `normalizeAccountRefs(text, aliases)` (wallet/cüzdan/hesap/account 1–2, birinci/ikinci, "iki numaralı", "benim hesabım", garbles `ek 2`/`AC2`/`a c c 2`/`O 2` -> `acc1`/`acc2`), `normalizeRecipient` + `buildAccountBook` + `shortAddress`, and `AccountRefLlm` which normalises the transcript **before** the model call.
- `agent/src/prompt.ts`: now just composes `buildSystemPrompt({ tools: createDefaultRegistry().definitions() })` (kept `withDetectedLanguage`). `index.ts` re-exports the new API.
- `tools/registry.ts` `ToolContext.aliases` + `tools/payment.ts` resolve a recipient via `normalizeRecipient` (keeps unknown names verbatim).
- `app/src/lib/agent.ts` (additive): loads `stellar_config` once (committed + env aliases), builds the config-aware prompt, wraps the LLM in `AccountRefLlm`, passes `toolContext.aliases`.
- `scripts/e2e-prompt-eval.mjs` + root `e2e:prompt` script: 31 utterances against the real provider.

## Verification
- `npm run check`: all 4 workspaces pass.
- `npm test -w @polaris/agent`: **140/140** pass (14 new). `npm test -w @polaris/app`: **173/173** pass.
- Live eval (`node --env-file=/.env scripts/e2e-prompt-eval.mjs`, model `claude-sonnet-5`): **31/31 = 100%** (positives incl. `acc1'den acc2'ye`, `wallet 1'den wallet 2'ye`, `ek 2`, `a c c 2`, `O 2`, `yarım dolar`; negatives: missing amount/asset/recipient, unknown recipient, send FROM acc2, chit-chat).
- Rust: not touched.

## Not done / human verify
- `get_balance` **not implemented**: the loop runs one model turn and would speak raw tool JSON, and registering it needs `runtime.ts` (out of scope). The prompt lists balances as unseen.
- PGUSD/TRY: not added — `assets.ts` is the single source and out of scope; prompt says they are unavailable (another worker adding them to `assets.ts` makes them appear automatically).
- "Ask when asset unspecified" is prompt-level; `parseSendPayment` still defaults to `USDC` (kept for the existing tests).

## Remaining work
- Merge `integration/wallet` + the other agent-tool branches; the capability list then picks up anchor/schedule/P2P tools with no prompt edit.
- A human should speak the eval utterances through the real mic/TTS path.
