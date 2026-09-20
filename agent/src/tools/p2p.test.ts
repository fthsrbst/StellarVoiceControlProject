import assert from "node:assert/strict";
import { test } from "node:test";

import { AgentError } from "../errors.ts";
import {
  p2pAcceptTool,
  p2pConfirmTool,
  p2pOfferTool,
  parseOfferId,
  parseP2pAccept,
  parseP2pConfirm,
  parseP2pOffer,
  parseTryPrice,
} from "./p2p.ts";

const ctx = { network: "testnet" as const, transcript: "100 USDC'yi 3400 liraya sat" };

test("sell offer arguments produce a p2p_offer Intent", () => {
  assert.deepEqual(parseP2pOffer({ amount: "100", asset: "USDC", priceTry: "3400" }, ctx), {
    kind: "p2p_offer",
    asset: "USDC",
    amount: "100",
    priceTry: "3400",
    source: "100 USDC'yi 3400 liraya sat",
  });
});

test("a numeric price and amount are coerced to decimal strings", () => {
  const intent = parseP2pOffer({ amount: 100, asset: "usdc", priceTry: 3400 }, ctx);
  assert.equal(intent.amount, "100");
  assert.equal(intent.priceTry, "3400");
  assert.equal(intent.asset, "USDC");
});

test("an offer price of zero or a third fraction digit is rejected", () => {
  for (const priceTry of ["0", "0.00", "1.234", "abc", -5]) {
    assert.throws(
      () => parseP2pOffer({ amount: "1", asset: "USDC", priceTry }, ctx),
      AgentError,
      `${String(priceTry)} should be rejected`,
    );
  }
});

test("take-offer produces a p2p_accept Intent with the spoken id", () => {
  assert.deepEqual(parseP2pAccept({ offerId: 3 }, ctx), {
    kind: "p2p_accept",
    asset: "USDC",
    amount: "0",
    offerId: 3,
    source: "100 USDC'yi 3400 liraya sat",
  });
  assert.equal(parseOfferId("p2p_accept", "3"), 3);
});

test("confirm-fiat produces a p2p_confirm Intent", () => {
  assert.deepEqual(parseP2pConfirm({ offerId: "3" }, ctx), {
    kind: "p2p_confirm",
    asset: "USDC",
    amount: "0",
    offerId: 3,
    source: "100 USDC'yi 3400 liraya sat",
  });
});

test("a missing or malformed offer id is rejected", () => {
  for (const input of [{}, { offerId: "three" }, { offerId: -1 }, { offerId: 1.5 }, null]) {
    assert.throws(() => parseP2pAccept(input, ctx), AgentError);
    assert.throws(() => parseP2pConfirm(input, ctx), AgentError);
  }
});

test("parseTryPrice accepts 1-2 fraction digits and rejects the rest", () => {
  assert.equal(parseTryPrice("p2p_offer", "3400.50"), "3400.50");
  assert.equal(parseTryPrice("p2p_offer", "0.01"), "0.01");
  assert.throws(() => parseTryPrice("p2p_offer", ""), AgentError);
});

test("every P2P tool is approval-gated and validates its arguments (W8)", () => {
  for (const tool of [p2pOfferTool, p2pAcceptTool, p2pConfirmTool]) {
    assert.equal(tool.requiresApproval, true);
    assert.equal(typeof tool.toIntent, "function");
  }
  assert.throws(() => p2pOfferTool.toIntent?.({ amount: "1" } as never, ctx), AgentError);
});
