import assert from "node:assert/strict";
import { test } from "node:test";

import { AgentError } from "../errors.ts";
import { normalizeFiat, parseDeposit, parseWithdraw } from "./anchor.ts";
import type { ToolContext } from "./registry.ts";

const ctx: ToolContext = { network: "testnet", transcript: "50 lira yatır" };

function isInputError(error: unknown): boolean {
  return error instanceof AgentError && error.kind === "input";
}

test("a deposit produces the expected Intent with the transcript as source", () => {
  assert.deepEqual(parseDeposit({ amount: "50" }, ctx), {
    kind: "deposit",
    asset: "TRY",
    amount: "50",
    source: "50 lira yatır",
  });
});

test("deposit fiat words canonicalise to TRY (English and Turkish)", () => {
  for (const asset of ["TRY", "try", "lira", "liras", "tl", "₺"]) {
    assert.equal(parseDeposit({ amount: "50", asset }, ctx).asset, "TRY", `${asset} should map to TRY`);
  }
});

test("a numeric deposit amount is coerced to the decimal-string rule", () => {
  const intent = parseDeposit({ amount: 100 }, { network: "testnet", transcript: "deposit 100 TRY" });
  assert.equal(intent.amount, "100");
  assert.equal(typeof intent.amount, "string");
});

test("a non-lira deposit asset is rejected as bad input", () => {
  assert.throws(() => parseDeposit({ amount: "50", asset: "USD" }, ctx), isInputError);
  assert.throws(() => parseDeposit({ amount: "abc" }, ctx), isInputError);
  assert.throws(() => parseDeposit("not an object", ctx), isInputError);
});

test("a withdrawal produces the expected Intent in the on-chain asset", () => {
  assert.deepEqual(parseWithdraw({ amount: "5", asset: "USDC" }, { network: "testnet", transcript: "withdraw 5 USDC to TRY" }), {
    kind: "withdraw",
    asset: "USDC",
    amount: "5",
    source: "withdraw 5 USDC to TRY",
  });
});

test("a withdrawal defaults to USDC and rejects unsupported assets", () => {
  assert.equal(parseWithdraw({ amount: "5" }, ctx).asset, "USDC");
  assert.throws(() => parseWithdraw({ amount: "5", asset: "BTC" }, ctx), isInputError);
  assert.throws(() => parseWithdraw({ amount: "0" }, ctx), isInputError);
});

test("normalizeFiat only accepts the lira vocabulary", () => {
  assert.equal(normalizeFiat(undefined), "TRY");
  assert.equal(normalizeFiat("  "), "TRY");
  assert.equal(normalizeFiat("EUR"), undefined);
  assert.equal(normalizeFiat(5), undefined);
});
