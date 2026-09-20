import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BASELINE_STEP_ORDER,
  DEFAULT_LIMITS,
  ENABLE_STEP_ORDER,
  actionForMode,
  changeKind,
  disableStepOrder,
  effectLine,
  effectiveFields,
  isArmed,
  matchesOrder,
  mergeAliasLines,
  parseAliasEditor,
  profileModeOf,
  readBackBaseline,
  readBackDisable,
  readBackEnable,
  readBackTighten,
  ruleFromFields,
  stateLines,
  stepIntent,
  stepLabel,
  validateBaseline,
  validateLimits,
  validateRuleFields,
  type LimitsFields,
  type SecurityState,
} from "./guardState.ts";

/** Public testnet keys (the committed aliases; never secrets). */
const EXECUTOR = "GB3HO3WGM273M2OZLE5DVRN5WNCNSART6H6SAHP4CXGK34MMGNNDYLX5";
const OWNER = "GARXWVNCJ22U2OR23LAB5Z5RWI2XFIJZA2R3TRPFUKKY65JQZZOEWWCO";
const NATIVE_SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

function fields(overrides: Partial<LimitsFields> = {}): LimitsFields {
  return { ...DEFAULT_LIMITS, ...overrides };
}

test("validateLimits accepts the default fields and rejects bad ones", () => {
  assert.equal(validateLimits(fields(), { executor: EXECUTOR, assetContractId: NATIVE_SAC }).ok, true);

  const order = validateLimits(fields({ threshold: "30" }), { executor: EXECUTOR, assetContractId: NATIVE_SAC });
  assert.equal(order.ok, false);
  assert.match(order.errors[0]!, /auto_approve_limit <= per_tx_limit <= daily_limit/);

  const small = validateLimits(fields({ allowance: "10" }), { executor: EXECUTOR, assetContractId: NATIVE_SAC });
  assert.equal(small.ok, false);
  assert.match(small.errors[0]!, /at least the daily limit/);

  const badExecutor = validateLimits(fields(), { executor: "nope", assetContractId: NATIVE_SAC });
  assert.equal(badExecutor.ok, false);
  assert.match(badExecutor.errors[0]!, /executor/);

  const badAmount = validateLimits(fields({ threshold: "abc" }), {
    executor: EXECUTOR,
    assetContractId: NATIVE_SAC,
  });
  assert.equal(badAmount.ok, false);
  assert.match(badAmount.errors[0]!, /decimal string/);
});

test("validateRuleFields validates the rule without an executor", () => {
  const ok = validateRuleFields(fields(), NATIVE_SAC);
  assert.equal(ok.ok, true);
  assert.equal(ok.rule?.auto_approve_limit, 5_0000000n);

  const bad = validateRuleFields(fields({ perTx: "0" }), NATIVE_SAC);
  assert.equal(bad.ok, false);
});

test("validateBaseline allows a zero threshold and keeps the executor unset", () => {
  const ok = validateBaseline(fields(), NATIVE_SAC);
  assert.equal(ok.ok, true);
  assert.equal(ok.rule?.auto_approve_limit, 0n);
  assert.equal(ok.rule?.known_recipients_only, true);

  const off = validateBaseline(fields({ knownRecipientsOnly: false }), NATIVE_SAC);
  assert.equal(off.rule?.known_recipients_only, false);
});

test("profileModeOf maps the chain state, never widening it", () => {
  const rule = ruleFromFields(fields(), NATIVE_SAC);
  assert.equal(profileModeOf({ rule: null, executor: null }), "always_ask");
  assert.equal(profileModeOf({ rule, executor: EXECUTOR }), "auto_under_limit");
  assert.equal(profileModeOf({ rule, executor: null }), "always_ask");
  assert.equal(profileModeOf({ rule: { ...rule, auto_approve_limit: 0n }, executor: EXECUTOR }), "always_ask");
  assert.equal(isArmed({ rule, executor: EXECUTOR }), true);
});

test("effectLine explains the profile in one sentence", () => {
  assert.match(effectLine("always_ask", fields(), "XLM"), /Every payment needs your approval/);
  assert.match(effectLine("auto_under_limit", fields(), "XLM"), /5 XLM\/tx and 20 XLM\/day/);
});

test("read-back sentences are built from the fields", () => {
  const validation = validateLimits(fields(), { executor: EXECUTOR, assetContractId: NATIVE_SAC });
  assert.ok(validation.draft);
  assert.match(readBackEnable(validation.draft, "XLM"), /Allow automatic payments up to 5 XLM/);
  assert.match(readBackBaseline(fields(), "XLM"), /approve 140 XLM to the guard for 30 days/);
  assert.match(readBackDisable(true, "XLM"), /revoke the remaining XLM allowance/);
  assert.match(readBackDisable(false, "XLM"), /^Stop automatic payments\?/);
});

test("changeKind distinguishes tightening from loosening", () => {
  const state = { rule: ruleFromFields(fields(), NATIVE_SAC), assetContractId: NATIVE_SAC };
  assert.equal(changeKind(state, fields({ daily: "10" })), "tightening");
  assert.equal(changeKind(state, fields({ daily: "50", allowance: "400" })), "loosening");
  assert.equal(changeKind({ ...state, rule: null }, fields()), null);
});

test("parseAliasEditor accepts good lines and reports bad ones", () => {
  const parsed = parseAliasEditor(`acc2 = ${EXECUTOR}\nbob=${OWNER}`);
  assert.equal(parsed.errors.length, 0);
  assert.deepEqual(parsed.entries, [
    { alias: "acc2", address: EXECUTOR },
    { alias: "bob", address: OWNER },
  ]);

  const bad = parseAliasEditor(`acc2=${EXECUTOR}\nacc2=${OWNER}\nbad=NOTANADDRESS\nnot a line`);
  assert.equal(bad.entries.length, 1);
  assert.equal(bad.errors.length, 3);
});

test("step order helpers fix the safe order (D13)", () => {
  assert.equal(matchesOrder(["approve", "set_rule", "set_executor"], ENABLE_STEP_ORDER), true);
  assert.equal(matchesOrder(["set_executor", "set_rule", "approve"], ENABLE_STEP_ORDER), false);
  assert.deepEqual([...BASELINE_STEP_ORDER], ["approve", "set_rule"]);
  assert.deepEqual(disableStepOrder(true), ["revoke_executor", "approve"]);
  assert.deepEqual(disableStepOrder(false), ["revoke_executor"]);
});

test("stepLabel and stepIntent describe a plan step", () => {
  assert.equal(stepLabel("set_executor"), "Register the agent key (arms auto-pay)");
  const intent = stepIntent("set_rule", fields(), "XLM");
  assert.equal(intent.kind, "guard_policy");
  assert.equal(intent.asset, "XLM");
  assert.equal(intent.amount, "5");
  // The amount is the step's real one, not the threshold for every step.
  assert.equal(stepIntent("approve", fields(), "XLM").amount, DEFAULT_LIMITS.allowance);
  assert.equal(stepIntent("set_executor", fields(), "XLM").amount, "0");
  assert.equal(stepIntent("revoke_executor", fields(), "XLM").amount, "0");
});

test("the profile mode drives the fields and the action (M2)", () => {
  const typed = fields({ threshold: "5" });
  assert.equal(effectiveFields("always_ask", typed).threshold, "0");
  assert.equal(effectiveFields("auto_under_limit", typed).threshold, "5");

  assert.equal(actionForMode("always_ask", false), "baseline");
  assert.equal(actionForMode("always_ask", true), "baseline");
  assert.equal(actionForMode("auto_under_limit", false), "enable");
  assert.equal(actionForMode("auto_under_limit", true), "tighten");
});

test("readBackTighten names the auto-approve threshold too (N4)", () => {
  assert.match(readBackTighten(fields({ threshold: "5" }), "XLM"), /auto-approve up to 5 XLM/);
});

test("mergeAliasLines unions loaded and just-saved names, newest wins (M3)", () => {
  const loaded = [
    { alias: "acc2", onChain: EXECUTOR, status: "ok" as const },
    { alias: "bob", onChain: null, status: "error" as const },
  ];
  const merged = mergeAliasLines(loaded, { bob: OWNER, carol: OWNER });
  assert.deepEqual(merged, [
    { alias: "acc2", onChain: EXECUTOR, status: "ok" },
    { alias: "bob", onChain: OWNER, status: "ok" },
    { alias: "carol", onChain: OWNER, status: "ok" },
  ]);
  assert.equal(merged.find((line) => line.alias === "bob")?.status, "ok");
});

test("stateLines render the decoded on-chain state", () => {
  const state: SecurityState = {
    owner: OWNER,
    guardContractId: NATIVE_SAC,
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
    assetSymbol: "XLM",
    assetContractId: NATIVE_SAC,
    rule: ruleFromFields(fields(), NATIVE_SAC),
    executor: EXECUTOR,
    spentTodayRaw: 3_0000000n,
    allowanceRaw: 140_0000000n,
    aliases: [{ alias: "acc2", onChain: EXECUTOR, status: "ok" }],
  };
  const lines = stateLines(state);
  const value = (label: string) => lines.find((line) => line.label === label)?.value;
  assert.equal(value("Profile"), "Auto under limit");
  assert.equal(value("Auto-approve"), "5 XLM");
  assert.equal(value("Spent today"), "3 XLM");
  assert.match(value("Executor")!, /…/);

  const notSetUp = stateLines({ ...state, rule: null, executor: null });
  assert.equal(notSetUp.find((line) => line.label === "Profile")?.value, "Always ask");
  assert.equal(notSetUp.find((line) => line.label === "Rule")?.value, "not published");
});
