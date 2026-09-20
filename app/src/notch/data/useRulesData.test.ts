import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_LIMITS, ruleFromFields, type SecurityState } from "../../lib/guardState.ts";
import { MOCK_RULES } from "../../lib/mockData.ts";
import { demoRulesView, mapRulesView } from "./useRulesData.ts";

/** Public testnet keys (the committed fixtures; never secrets). */
const EXECUTOR = "GB3HO3WGM273M2OZLE5DVRN5WNCNSART6H6SAHP4CXGK34MMGNNDYLX5";
const OWNER = "GARXWVNCJ22U2OR23LAB5Z5RWI2XFIJZA2R3TRPFUKKY65JQZZOEWWCO";
const SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

function state(overrides: Partial<SecurityState> = {}): SecurityState {
  return {
    owner: OWNER,
    guardContractId: SAC,
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
    assetSymbol: "XLM",
    assetContractId: SAC,
    rule: ruleFromFields(DEFAULT_LIMITS, SAC),
    executor: EXECUTOR,
    spentTodayRaw: 3_0000000n,
    allowanceRaw: 140_0000000n,
    aliases: [{ alias: "acc2", onChain: EXECUTOR, status: "ok" }],
    ...overrides,
  };
}

test("an unconfigured guard read becomes the unconfigured state", () => {
  const view = mapRulesView({ kind: "unconfigured", detail: "GUARD_CONTRACT_ID is not set" });
  assert.equal(view.state, "unconfigured");
  assert.match(view.detail, /GUARD_CONTRACT_ID/);
  assert.deepEqual(view.lines, []);
  assert.equal(view.demo, false);
});

test("a failed read becomes error (not mock data)", () => {
  const view = mapRulesView({ kind: "unreachable", detail: "rpc down" });
  assert.equal(view.state, "error");
  assert.equal(view.detail, "rpc down");
  assert.equal(view.demo, false);
});

test("a configured owner with no rule is not set up", () => {
  const view = mapRulesView({ kind: "ok", state: state({ rule: null, executor: null }) });
  assert.equal(view.state, "not_set_up");
  assert.deepEqual(view.lines, []);
});

test("a published rule renders the Security panel read-back", () => {
  const view = mapRulesView({ kind: "ok", state: state() });
  assert.equal(view.state, "ready");
  assert.equal(view.demo, false);
  const value = (label: string): string | undefined =>
    view.lines.find((line) => line.label === label)?.value;
  assert.equal(value("Profile"), "Auto under limit");
  assert.equal(value("Auto-approve"), "5 XLM");
  assert.equal(value("Per day"), "20 XLM");
  assert.equal(value("Recipients"), "saved contacts only");
  assert.equal(value("Spent today"), "3 XLM");
  assert.match(value("Executor")!, /…/);
});

test("the alias book is summarised, never with secret material", () => {
  const two = mapRulesView({
    kind: "ok",
    state: state({
      aliases: [
        { alias: "acc2", onChain: EXECUTOR, status: "ok" },
        { alias: "bob", onChain: OWNER, status: "ok" },
        { alias: "carol", onChain: null, status: "error" },
      ],
    }),
  });
  assert.equal(two.lines.find((line) => line.label === "Saved contacts")?.value, "2 saved, 1 unreadable");

  const none = mapRulesView({ kind: "ok", state: state({ aliases: [] }) });
  assert.equal(none.lines.find((line) => line.label === "Saved contacts")?.value, "none");
});

test("the demo view labels the mock fallback", () => {
  const view = demoRulesView();
  assert.equal(view.demo, true);
  assert.equal(view.state, "ready");
  assert.equal(view.lines.length, MOCK_RULES.length);
});
