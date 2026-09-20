import assert from "node:assert/strict";
import { test } from "node:test";

import {
  aliasNameForAddress,
  buildAliasEntries,
  fetchOwnerAccount,
  fetchOwnerPayments,
  friendbotUrl,
  mapHistoryRecords,
  mapWalletTransactions,
  trimAmount,
  type FetchLike,
  type HorizonPaymentRecord,
} from "./history.ts";

const OWNER = "GARXWVNCJ22U2OR23LAB5Z5RWI2XFIJZA2R3TRPFUKKY65JQZZOEWWCO";
const FRIEND = "GB3HO3WGM273M2OZLE5DVRN5WNCNSART6H6SAHP4CXGK34MMGNNDYLX5";
const OTHER = "GB7YX7MYCIGU6DRSBACQ4HJHQAVUP4K7BHT7NP5VP6IYVACDSEF3F2EE";

function payment(overrides: Partial<HorizonPaymentRecord> = {}): HorizonPaymentRecord {
  return {
    id: "1",
    type: "payment",
    transaction_hash: "a".repeat(64),
    created_at: "2026-09-20T10:00:00Z",
    from: OWNER,
    to: FRIEND,
    amount: "10.0000000",
    asset_type: "native",
    successful: true,
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test("trimAmount drops trailing fractional zeros", () => {
  assert.equal(trimAmount("10.0000000"), "10");
  assert.equal(trimAmount("18.4000000"), "18.4");
  assert.equal(trimAmount("10"), "10");
  assert.equal(trimAmount("0.0000001"), "0.0000001");
});

test("mapWalletTransactions resolves direction, alias and explorer link", () => {
  const rows = mapWalletTransactions(
    [
      payment({ id: "out", to: FRIEND }),
      payment({
        id: "in",
        from: OTHER,
        to: OWNER,
        amount: "5.5000000",
        created_at: "2026-09-19T09:00:00Z",
      }),
    ],
    { ownerAddress: OWNER, aliasEntries: buildAliasEntries(undefined, { bob: { address: FRIEND } }) },
  );
  assert.equal(rows.length, 2);
  const [sent, received] = rows;
  assert.equal(sent?.direction, "sent");
  assert.equal(sent?.counterparty, FRIEND);
  assert.equal(sent?.counterpartyAlias, "bob");
  assert.equal(sent?.amount, "10");
  assert.equal(sent?.asset, "XLM");
  assert.match(sent?.explorerUrl ?? "", /\/tx\/a{64}$/);
  assert.equal(received?.direction, "received");
  assert.equal(received?.counterpartyAlias, undefined);
});

test("mapWalletTransactions sorts newest first and skips unrelated records", () => {
  const rows = mapWalletTransactions(
    [
      payment({ id: "old", created_at: "2026-09-01T00:00:00Z" }),
      payment({ id: "new", created_at: "2026-09-20T00:00:00Z" }),
      payment({ id: "merge", type: "account_merge" }),
      payment({ id: "failed", successful: false }),
    ],
    { ownerAddress: OWNER },
  );
  assert.deepEqual(
    rows.map((row) => row.id),
    ["new", "old"],
  );
});

test("mapWalletTransactions understands a create_account from the owner", () => {
  const rows = mapWalletTransactions(
    [
      payment({
        type: "create_account",
        from: undefined,
        to: undefined,
        funder: OWNER,
        account: OTHER,
        starting_balance: "10000.0000000",
        amount: undefined,
      }),
    ],
    { ownerAddress: OWNER },
  );
  assert.equal(rows[0]?.direction, "sent");
  assert.equal(rows[0]?.counterparty, OTHER);
  assert.equal(rows[0]?.amount, "10000");
});

test("mapHistoryRecords keeps only outgoing payments as raw units", () => {
  const records = mapHistoryRecords(
    [
      payment({ id: "out", to: FRIEND, amount: "10.0000000" }),
      payment({ id: "in", from: OTHER, to: OWNER }),
      payment({ id: "failed", successful: false }),
      payment({ id: "bad-amount", amount: "not-a-number" }),
    ],
    OWNER,
  );
  assert.equal(records.length, 1);
  assert.equal(records[0]?.id, "out");
  assert.equal(records[0]?.recipientAddress, FRIEND);
  assert.equal(records[0]?.amountRaw, 100_000_000n);
  assert.equal(records[0]?.mode, "public");
  assert.equal(records[0]?.status, "confirmed");
});

test("buildAliasEntries merges env over committed and drops malformed entries", () => {
  const entries = buildAliasEntries(
    { bob: OTHER, Bad: FRIEND, carol: "not-an-address" },
    { bob: { address: FRIEND }, ada: { address: OWNER }, weird: { address: "x" } },
  );
  assert.deepEqual(
    entries.map((entry) => [entry.name, entry.address, entry.source]),
    [
      ["ada", OWNER, "committed"],
      ["bob", OTHER, "env"],
    ],
  );
  assert.equal(aliasNameForAddress(entries, OWNER), "ada");
  assert.equal(aliasNameForAddress(entries, "G".padEnd(56, "A")), undefined);
});

test("fetchOwnerAccount maps balances and sorts native first", async () => {
  const fetchImpl: FetchLike = async () =>
    jsonResponse(200, {
      balances: [
        { asset_type: "credit_alphanum4", asset_code: "USDC", balance: "12.5000000" },
        { asset_type: "native", balance: "100.0000000" },
      ],
    });
  const result = await fetchOwnerAccount("https://horizon.test", OWNER, { fetchImpl });
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.deepEqual(
    result.balances.map((balance) => [balance.asset, balance.native]),
    [
      ["XLM", true],
      ["USDC", false],
    ],
  );
});

test("fetchOwnerAccount distinguishes a 404 from a network failure", async () => {
  const notFound: FetchLike = async () => jsonResponse(404, {});
  assert.deepEqual(await fetchOwnerAccount("https://h", OWNER, { fetchImpl: notFound }), {
    status: "not_found",
  });

  const down: FetchLike = async () => {
    throw new Error("getaddrinfo ENOTFOUND");
  };
  const offline = await fetchOwnerAccount("https://h", OWNER, { fetchImpl: down });
  assert.equal(offline.status, "offline");
});

test("fetchOwnerPayments reads the embedded records and clamps the limit", async () => {
  let requested = "";
  const fetchImpl: FetchLike = async (url) => {
    requested = url;
    return jsonResponse(200, { _embedded: { records: [payment()] } });
  };
  const result = await fetchOwnerPayments("https://horizon.test/", OWNER, {
    fetchImpl,
    limit: 10,
  });
  assert.equal(result.status, "ok");
  assert.ok(requested.includes("/accounts/" + OWNER + "/payments"));
  assert.ok(requested.endsWith("limit=10&include_failed=false"));
  if (result.status === "ok") assert.equal(result.payments.length, 1);
});

test("friendbotUrl encodes the address", () => {
  assert.equal(friendbotUrl(OWNER), `https://friendbot.stellar.org/?addr=${OWNER}`);
});
