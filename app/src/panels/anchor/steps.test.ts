import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ANCHOR_STEPS,
  anchorFlowReducer,
  createFlowState,
  stepForExplain,
  validateDepositAmount,
  validateWithdrawAmount,
} from "./steps.ts";

test("every step starts pending and the log is empty", () => {
  const state = createFlowState();
  assert.deepEqual(state.log, []);
  assert.deepEqual(state.error, null);
  for (const step of ANCHOR_STEPS) assert.equal(state.steps[step.id], "pending");
});

test("the reducer updates one step without touching the others", () => {
  const next = anchorFlowReducer(createFlowState(), { type: "step", id: "auth", status: "active" });
  assert.equal(next.steps.auth, "active");
  assert.equal(next.steps.discover, "pending");
});

test("the reducer appends log lines, stores errors and resets", () => {
  let state = anchorFlowReducer(createFlowState(), {
    type: "log",
    line: { step: "sep1.toml", what: "discovered", why: "so we know where to talk" },
  });
  state = anchorFlowReducer(state, { type: "error", message: "boom" });
  assert.equal(state.log.length, 1);
  assert.equal(state.error, "boom");
  assert.deepEqual(anchorFlowReducer(state, { type: "reset" }), createFlowState());
});

test("stepForExplain maps the anchor client's labels onto the panel steps", () => {
  assert.equal(stepForExplain("sep1.toml"), "discover");
  assert.equal(stepForExplain("sep10.sign"), "auth");
  assert.equal(stepForExplain("preflight.ready"), "account");
  assert.equal(stepForExplain("preflight.trustline"), "trustline");
  assert.equal(stepForExplain("sep6.status.completed"), "deposit");
  assert.equal(stepForExplain("horizon.balance"), "completed");
  assert.equal(stepForExplain("unknown.step"), undefined);
});

test("deposit amounts are clamped to the shared-treasury window", () => {
  assert.deepEqual(validateDepositAmount("50"), { ok: true, amount: "50" });
  assert.deepEqual(validateDepositAmount("100"), { ok: true, amount: "100" });
  assert.equal(validateDepositAmount("49").ok, false);
  assert.equal(validateDepositAmount("101").ok, false);
  assert.equal(validateDepositAmount("0").ok, false);
  assert.equal(validateDepositAmount("abc").ok, false);
});

test("withdraw amounts are validated in the on-chain asset", () => {
  assert.deepEqual(validateWithdrawAmount("1"), { ok: true, amount: "1" });
  assert.equal(validateWithdrawAmount("0.5").ok, false);
  assert.equal(validateWithdrawAmount("101").ok, false);
});
