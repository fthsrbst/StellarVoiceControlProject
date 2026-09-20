import assert from "node:assert/strict";
import { test } from "node:test";

import type { HorizonPaymentRecord } from "../../lib/history.ts";
import { deriveWalletView, formatTransactionTime, shortAddress } from "./walletModel.ts";

const OWNER = "GARXWVNCJ22U2OR23LAB5Z5RWI2XFIJZA2R3TRPFUKKY65JQZZOEWWCO";
const FRIEND = "GB3HO3WGM273M2OZLE5DVRN5WNCNSART6H6SAHP4CXGK34MMGNNDYLX5";

function payment(overrides: Partial<HorizonPaymentRecord> = {}): HorizonPaymentRecord {
  return {
    id: "1",
    type: "payment",
    transaction_hash: "b".repeat(64),
    created_at: "2026-09-20T10:00:00Z",
    from: OWNER,
    to: FRIEND,
    amount: "1.0000000",
    asset_type: "native",
    successful: true,
    ...overrides,
  };
}

test("shortAddress keeps the first and last four characters", () => {
  assert.equal(shortAddress(OWNER), "GARX…WWCO");
  assert.equal(shortAddress("GABC"), "GABC");
});

test("a missing owner is unconfigured", () => {
  const view = deriveWalletView({ ownerAddress: null, account: null, payments: null });
  assert.equal(view.status, "unconfigured");
  assert.equal(view.ownerAddress, null);
});

test("a null account means still loading", () => {
  const view = deriveWalletView({ ownerAddress: OWNER, account: null, payments: null });
  assert.equal(view.status, "loading");
  assert.equal(view.shortAddress, "GARX…WWCO");
});

test("a 404 account is unfunded and offers Friendbot", () => {
  const view = deriveWalletView({
    ownerAddress: OWNER,
    account: { status: "not_found" },
    payments: null,
  });
  assert.equal(view.status, "unfunded");
  assert.match(view.friendbotUrl ?? "", /^https:\/\/friendbot\.stellar\.org\/\?addr=G/);
});

test("an offline account is offline with the reason", () => {
  const view = deriveWalletView({
    ownerAddress: OWNER,
    account: { status: "offline", message: "timeout" },
    payments: null,
  });
  assert.equal(view.status, "offline");
  assert.match(view.message, /timeout/);
});

test("a funded account is ready and keeps at most ten transactions", () => {
  const payments = Array.from({ length: 12 }, (_, index) =>
    payment({ id: `p${index}`, created_at: `2026-09-${String(20 - index).padStart(2, "0")}T10:00:00Z` }),
  );
  const view = deriveWalletView({
    ownerAddress: OWNER,
    account: {
      status: "ok",
      balances: [{ asset: "XLM", balance: "100.0000000", native: true }],
    },
    payments: { status: "ok", payments },
  });
  assert.equal(view.status, "ready");
  assert.equal(view.balances.length, 1);
  assert.equal(view.transactions.length, 10);
  assert.ok(view.explorerUrl?.endsWith(`/account/${OWNER}`));
});

test("formatTransactionTime is a stable local label", () => {
  const label = formatTransactionTime(Date.parse("2026-09-20T10:00:00Z"), "UTC");
  assert.match(label, /Sep 20/);
});
