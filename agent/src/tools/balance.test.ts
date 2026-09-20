import assert from "node:assert/strict";
import { test } from "node:test";

import {
  balanceSentence,
  formatBalanceAmount,
  getBalanceTool,
  trimAmount,
  type AssetBalance,
} from "./balance.ts";

const ctx = { network: "testnet" as const, transcript: "bakiyem ne kadar" };

test("trimAmount strips the fixed 7-decimal noise", () => {
  assert.equal(trimAmount("9989.0000000"), "9989");
  assert.equal(trimAmount("0.5000000"), "0.5");
  assert.equal(trimAmount("0.0000000"), "0");
  assert.equal(trimAmount(" 1.2500000 "), "1.25");
});

test("formatBalanceAmount groups by language", () => {
  assert.equal(formatBalanceAmount("9989.0000000", "en"), "9,989");
  assert.equal(formatBalanceAmount("9989.0000000", "tr"), "9.989");
  assert.equal(formatBalanceAmount("1234567.5000000", "en"), "1,234,567.5");
  assert.equal(formatBalanceAmount("0.5000000", "tr"), "0,5");
});

test("balanceSentence speaks non-zero balances with XLM first", () => {
  const balances: AssetBalance[] = [
    { code: "PGUSD", amount: "108.0000000" },
    { code: "XLM", amount: "9989.0000000" },
    { code: "USDC", amount: "0.0000000" },
  ];
  assert.equal(balanceSentence(balances, "en"), "You have 9,989 XLM and 108 PGUSD.");
  assert.equal(balanceSentence(balances, "tr"), "9.989 XLM, 108 PGUSD bakiyen var.");
});

test("balanceSentence says when nothing is held", () => {
  assert.equal(balanceSentence([], "en"), "You have no balance to show.");
  assert.equal(balanceSentence([], "tr"), "Bakiyende gösterecek bir varlık yok.");
});

test("get_balance's run produces the exact sentence toSpeech returns", async () => {
  const result = await getBalanceTool.run(
    { language: "en" },
    { ...ctx, readBalances: async () => [{ code: "XLM", amount: "12.0000000" }] },
  );
  assert.equal(result.spoken, "You have 12 XLM.");
  assert.equal(getBalanceTool.toSpeech?.(result), "You have 12 XLM.");
});

test("get_balance degrades to a short sentence with no reader or a failed read", async () => {
  const missing = await getBalanceTool.run({ language: "tr" }, ctx);
  assert.equal(missing.spoken, "Bakiyeni şu an okuyamıyorum.");
  const failed = await getBalanceTool.run(
    { language: "en" },
    {
      ...ctx,
      readBalances: async () => {
        throw new Error("horizon down");
      },
    },
  );
  assert.equal(failed.spoken, "I can't read your balance right now.");
});

test("get_balance is read-only: no approval and no intent", () => {
  assert.equal(getBalanceTool.requiresApproval, undefined);
  assert.equal(getBalanceTool.toIntent, undefined);
});
