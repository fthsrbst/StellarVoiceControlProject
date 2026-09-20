import assert from "node:assert/strict";
import { test } from "node:test";

import type { WalletTransaction } from "../../lib/history.ts";
import type { TurnLogEntry } from "../../lib/turnLog.ts";
import {
  chainToRow,
  mergeHistory,
  turnStatus,
  turnToRow,
  turnsToRows,
} from "./historyModel.ts";

const HASH = "a".repeat(64);
const FRIEND = "GB3HO3WGM273M2OZLE5DVRN5WNCNSART6H6SAHP4CXGK34MMGNNDYLX5";

function turn(overrides: Partial<TurnLogEntry> = {}): TurnLogEntry {
  return {
    id: "t1",
    timestampMs: 1_700_000_100_000,
    transcript: "Alice'e 10 USDC gönder",
    answer: "Sent 10 USDC to Alice.",
    outcome: "tx_submitted",
    txHash: HASH,
    explorerUrl: `https://stellar.expert/explorer/testnet/tx/${HASH}`,
    ...overrides,
  };
}

function payment(overrides: Partial<WalletTransaction> = {}): WalletTransaction {
  return {
    id: "p1",
    hash: HASH,
    direction: "sent",
    counterparty: FRIEND,
    amount: "10",
    asset: "USDC",
    createdAtMs: 1_700_000_200_000,
    explorerUrl: `https://stellar.expert/explorer/testnet/tx/${HASH}`,
    ...overrides,
  };
}

test("turnStatus maps outcomes onto the three status icons", () => {
  assert.equal(turnStatus("tx_submitted"), "success");
  assert.equal(turnStatus("answered"), "success");
  assert.equal(turnStatus("in_progress"), "pending");
  assert.equal(turnStatus("failed: Chain error"), "failed");
  assert.equal(turnStatus("superseded"), "failed");
});

test("turnToRow keeps transcript/answer and only expands when a tx exists", () => {
  const submitted = turnToRow(turn());
  assert.equal(submitted.id, "turn:t1");
  assert.equal(submitted.timestamp, 1_700_000_100);
  assert.equal(submitted.action, "Transaction submitted");
  assert.equal(submitted.txHash, HASH);
  assert.equal(submitted.explorerUrl, `https://stellar.expert/explorer/testnet/tx/${HASH}`);

  const plain = turnToRow(turn({ outcome: "answered", txHash: null, explorerUrl: null }));
  assert.equal(plain.action, null);
  assert.equal(plain.status, "success");
});

test("chainToRow resolves direction, alias and explorer link", () => {
  const sent = chainToRow(payment({ counterpartyAlias: "alice" }));
  assert.equal(sent.transcript, "Sent 10 USDC");
  assert.equal(sent.response, "To alice");
  assert.equal(sent.action, "Sent 10 USDC to alice");
  assert.equal(sent.explorerUrl, `https://stellar.expert/explorer/testnet/tx/${HASH}`);

  const received = chainToRow(
    payment({ direction: "received", counterparty: FRIEND, counterpartyAlias: undefined }),
  );
  assert.equal(received.response, `From ${FRIEND.slice(0, 6)}…${FRIEND.slice(-4)}`);
});

test("mergeHistory sorts newest first and drops a chain echo of a submitted turn", () => {
  const rows = mergeHistory(turnsToRows([turn()]), [chainToRow(payment())]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.id, "turn:t1");
});

test("mergeHistory keeps unrelated chain rows", () => {
  const rows = mergeHistory(
    turnsToRows([turn()]),
    [chainToRow(payment({ id: "p2", hash: "b".repeat(64) }))],
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.id, "chain:p2");
  assert.equal(rows[1]?.id, "turn:t1");
});
