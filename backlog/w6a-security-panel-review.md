# Review: W6a — Security & rules panel

- **Date:** 2026-09-20 · **Reviewer:** independent (L4, read-only) · **Under review:** `git diff origin/main...HEAD`
- **Verdict: REJECT** — one BLOCKER makes every multi-step flow unusable on-chain; fixes 2–3 strongly recommended.

## Verified correct
- Enable order is pinned and asserted (`guardState.ts:349,359-363`); `runTxSequence` stops at the first non-submitted step (`txPipeline.ts:215-230`), so any prefix fails closed.
- Amount parsing is strict (`guard/amount.ts:27,39-49`): rejects negative/empty/signed/exponent, caps 12 integer + 7 fraction digits and `i128::MAX`.
- Limits mirror the contract: order + `allowance >= daily` (`approval/types.ts:196-226`); one asset; executor/asset strkey-checked before any XDR.
- No signing/submission outside the pipeline: all writes go `buildPlan → tx.run` (`SecurityPanel.tsx:82-123`); `guardStateLive` only builds unsigned XDR + reads.
- No secret/env exposure; `POLARIS_ALLOW_AUTO_APPROVE` untouched. No `known_recipients_only` bypass found (baseline is threshold 0; enable/tighten honour the checkbox).
- Rust untouched by the change — cargo not run.

## BLOCKER
**B1. Multi-step plans embed one source sequence → only the first tx submits.**
`planEnable` builds approve+set_rule+set_executor up front (`guardStateLive.ts:166-193`); so do baseline (2), disable+revoke (2) and `planSetAliases` (N) (`guardStateLive.ts:296-322`). Each build calls `rpc.getAccount(owner)` and `TransactionBuilder` emits `account.seq + 1` (`guard/invoke.ts:43`; `@stellar/stellar-sdk` `transaction_builder.js:691`), and no submit happens between builds. `runTxSequence` then submits them in order, so after step 1 the account sequence advanced and every later step is rejected `tx_bad_seq`. Result: "Enable auto-pay" stops after the allowance (`set_rule` fails, executor never set); "Always-ask baseline" stops after approve; disable-with-revoke never runs the `approve(0)` kill switch; only the first alias saves. State left is fail-closed but the feature is non-functional and retry fails at the same point.
The project already solved this — `resequenceEnvelope`/`setSequence` (`live/submit.ts:185-215`) and `live/tool.ts:392-424` give each step `base + n` before the card renders it. W6a does not use it.
**Fix:** resequence each plan step (`base + index` per source) before `buildGuardCallSummary`/the approval card, or build each step lazily inside the pipeline right before signing; recompute the payload hash from the resequenced XDR.

## MAJOR
**M2. The profile radio is cosmetic; "Always ask" can still arm auto-pay at the typed threshold.** `mode` drives only copy and the (disabled) threshold display (`SecurityPanel.tsx:47,60,163`; `ProfileForm.tsx:84,126-128`); the enable button stays live and `planEnable` uses `fields.threshold` unchanged (`SecurityPanel.tsx:110`). Scenario: switch to Auto under limit, type 5, switch back to Always ask (field shows `0`, copy says "nothing is auto-approved"), click "Enable auto-pay" → the chain is armed at 5 XLM. The report's "mode only narrows what the chain enforces" is false. **Fix:** derive the effective draft from `mode` (baseline/0 when `always_ask`) and disable enable in that mode, or make the radio read-only from chain state.

**M3. The alias list is not the on-chain book.** `readAliases` only reads names in `aliases.json` + `POLARIS_ALIASES` (`guardStateLive.ts:70-85`), so an alias just saved through the panel never reappears after refresh, and any per-alias read error is rendered as "not on chain" (`AliasEditor.tsx:43`). The owner cannot trust the list. **Fix:** keep the union including just-saved names and distinguish "read failed" from "absent".

## MINOR / NIT
- **N4.** `planEnable.note` says "1 approval card + Touch ID" (`guardStateLive.ts:191`) but the panel runs one card + Touch ID per step (3). Armed `readBackTighten` also omits the `auto_approve_limit` the built rule still carries (`guardState.ts:261-266`).
- **N5.** `stepIntent` puts `fields.threshold` as `amount` for every step, including `approve` (real amount = allowance) and disable (`guardState.ts:339-346`). The card decodes the XDR, so display is honest, but the stored `Intent.amount` is wrong. Also `baselineRule` silently ignores a checked "Saved contacts only" (`guardState.ts:141-149`).
- **N6.** No in-flight guard while `buildPlan` awaits the plan build (buttons use `tx.state`, still idle), so a fast double click can start two sequences (`SecurityPanel.tsx:82-99`). The `already_armed` check reuses the mount-time snapshot, so a concurrent external arming is not detected (TOCTOU, testnet-only).
- **N7.** Report/`backlog.md` claim "12 pure tests"; `guardState.test.ts` has 11 (184 now vs 173 at W0d). `sprints.md:207` appends the W6a line to the T5 line with no newline, merging the T6 checklist item into it.
- **N8.** `onAction` computes an `effective` field set for baseline that the baseline branch never uses (`SecurityPanel.tsx:104-108`); `format` duplicates `fromRawUnits` though `guardState` already imports the SDK (`SecurityPanel.tsx:213-218`).

## Commands run (real)
- `npm run check` → pass (no output; interfaces/agent/stellar/app).
- `npm test -w @polaris/app` → **184 passed, 0 failed**.
- `npm test -w @polaris/stellar` → unit **145 passed**; live `src/live` **112 passed, 0 failed**.
- No cargo run: the W6a commit touches no `.rs` (`git show 767a65b --stat`).
