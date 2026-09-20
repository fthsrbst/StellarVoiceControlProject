# Report: W6a — Security & rules panel
- **Date:** 2026-09-20
- **Worker/Agent:** opencode worker (deepseek-v4.1-flash)
- **Branch:** `feat/w6a-security-panel` · **Worktree:** `.worktrees/w6a-security`

## What was done / why
The tuned rule set designed in `docs/approval-and-scheduling.md` (§2/§3/§11, D10/D13) is now visible
and operable in the app: the Security panel reads the owner's **current on-chain state**, shows the
profile and limits that the chain actually enforces, and lets the owner set up, enable, change and
disable auto-pay plus edit the alias book — always through the shared approval pipeline.

## Files touched (all inside scope)
- `app/src/lib/guardState.ts` — pure view model/validators: field validation via the guard-mirroring
  `validateAutoPayDraft`/`validateRuleAndAllowance`/`validateBaselineSetup`, `profileFromChain` ->
  panel mode (never widened), `stateLines`, effect/read-back sentences, `classifyChange` wrapper,
  alias-line parser, the fixed enable/baseline/disable orders, `stepLabel`/`stepIntent`/`matchesOrder`.
- `app/src/lib/guardStateLive.ts` — live reads via the guard client (`getRule`/`getExecutor`/
  `spentToday`/`getAlias` + `getAllowance`) and builder calls (`buildEnableAutoPay`,
  `buildBaselineSetup`, `buildTightenRule`, `buildDisableAutoPay`, `setAlias`); native XLM SAC id
  derived from the native asset + passphrase (`Asset.native().contractId(...)` —
  `CDLZFC3S…GCYSC`, verified in-node). Config (owner/guard/rpc/passphrase) from `stellar_config`.
- `app/src/lib/guardState.test.ts` — 11 pure tests.
- `app/src/panels/SecurityPanel.tsx` (body only) + `app/src/panels/security/{ProfileForm,AliasEditor}.tsx`.
- `app/src/debug/checks/security.ts` — W6 check (guard id configured + reachable, rule readable,
  executor state; `warn` when not set up).

## Decisions
- Every on-chain write goes through `useTxRun`/`runTxSequence` (one approval card + Touch ID +
  Freighter per step, progress list, stop on first failure, explorer link per submitted step). The
  panel never signs and never touches the network to submit.
- Safe order pinned by D13 and asserted at plan time: enable = `approve → set_rule → set_executor`
  (executor last = arming), baseline = `approve → set_rule`, disable = `revoke_executor` first with an
  optional `approve(0)`. `matchesOrder` fails the plan if the builder ever drifts.
- One asset per rule (contract max, §2): the panel fixes the asset to native XLM and derives its SAC;
  no multi-asset UI.
- `mode`/`always_ask` only narrows what the chain enforces; the enable button is disabled (fail
  closed) unless `validateLimits` passes, so no loosening is ever submitted silently.

## Test output (real)
- `npm run check -w @polaris/app` — pass (no output).
- `npm test -w @polaris/app` — **184 tests, 184 pass, 0 fail** (11 new in `guardState.test.ts`).
- `npm run build -w @polaris/app` — built OK; only the pre-existing `INEFFECTIVE_DYNAMIC_IMPORT`
  warnings (`approver.ts`, `signing.ts`, `aliases.json` static+dynamic import), unchanged by this task.
- Rust untouched — no cargo run was needed.

## Remaining work / human verification
- **Not verified (needs a human):** live read + a full enable/tighten/disable run against testnet with
  Touch ID and Freighter; the Debug **Security** check against the deployed guard (it degrades to
  `warn` "not set up" / `fail` "unreachable" as designed). No live guard run was performed here.
- The panel does not use the `EnableAutoPayResult.summary` combined card directly (it renders one
  decoded summary per step through the existing per-step approval card); a single combined 3-action
  card remains a possible later polish.

## Blocked / handoff
- **Executor address:** `stellar_config` returns no executor key, so the operator must paste the
  agent's public `G…` key into the panel's "Executor" field before enabling auto-pay (a hidden line in
  `runEnable` notes this). Reading a configured executor (e.g. `POLARIS_EXECUTOR_ADDRESS`) needs a Rust
  change outside this task's scope — handoff to W1/W3 if desired.

## Review fixes (2026-09-20, W6a-fix)
- **B1 (blocker):** `runTxSequence` resequences every step's unsigned XDR against its source's current on-chain sequence right before approval, recomputes the digest from the resequenced XDR and refreshes the summary's explorer link; reuses `resequenceEnvelope`/`setSequence` (now exported from `@polaris/stellar`). Optional lazy `build()` is preferred when present. `txPipeline.test.ts` +3 (submits 101/102/103, failure stops the rest, build preferred).
- **M2:** the radio drives the plan — "Always ask" forces threshold 0 and builds the baseline; only "Auto under limit" arms the typed threshold (`effectiveFields`/`actionForMode`, tested). Supersedes the old "mode only narrows" claim.
- **M3:** alias list is the union of loaded + just-saved names; a read error renders "read failed", distinct from "not on chain".
- **N4–N8:** note says one card + Touch ID per step; `readBackTighten` names the real auto-approve limit; `stepIntent` stores each step's real amount; baseline honours "Saved contacts only"; in-flight double-click guard; dead `effective`/duplicate `format` removed; test count corrected to 11.
- Counts after fixes: app **190 pass / 0 fail**; stellar suites green (keeper 67, live 112, others 197/122/133/112/121/145); `npm run check` + app build green. Live testnet + Touch ID/Freighter still needs a human.
