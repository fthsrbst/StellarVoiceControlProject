// Regression tests for the fixture's live Horizon payload path.
//
// The bug: a Horizon `AccountResponse` exposes `sequenceNumber` as a *method*,
// so passing `account.sequenceNumber` straight into `new Account(...)` made the
// SDK throw "sequence must be of type string" whenever Horizon was reachable.
// The injectable loader lets these tests exercise that path without a network.
import assert from "node:assert/strict";
import { test } from "node:test";

import { TransactionBuilder } from "@stellar/stellar-sdk";

import { buildUnsignedPayload, parseAliases } from "./bridge-fixture.mjs";

const OWNER = "GAJW5V7VXHIRTJBGNVYTGXJ6CLDM7IEIPAYD3XLKKTKJKPRBYOTAC25A";
const DESTINATION = "GB25QEDATQREAQQHBW3DAGLOZ3EURS44URZETXLLREPPYCX2ABCORNLV";
const PASSPHRASE = "Test SDF Network ; September 2015";
const HORIZON_URL = "https://horizon-testnet.stellar.org";
const SEQUENCE = "20476454152175616";

test("loads the live sequence from a method-based Horizon account", async () => {
  const requests = [];
  const result = await buildUnsignedPayload({
    owner: OWNER,
    destination: DESTINATION,
    horizonUrl: HORIZON_URL,
    networkPassphrase: PASSPHRASE,
    loadAccount: async (request) => {
      requests.push(request);
      return { sequenceNumber: () => SEQUENCE };
    },
  });

  assert.equal(result.offline, false);
  assert.deepEqual(requests, [{ owner: OWNER, horizonUrl: HORIZON_URL }]);

  const transaction = TransactionBuilder.fromXDR(result.payload.xdr, PASSPHRASE);
  assert.equal(transaction.sequence, (BigInt(SEQUENCE) + 1n).toString());
  assert.equal(result.payload.summary.lines.at(-1), `Sequence ${SEQUENCE} loaded from Horizon`);
});

test("falls back to the labelled offline placeholder when the loader rejects", async () => {
  const result = await buildUnsignedPayload({
    owner: OWNER,
    destination: DESTINATION,
    horizonUrl: HORIZON_URL,
    networkPassphrase: PASSPHRASE,
    loadAccount: async () => {
      throw new Error("network unreachable");
    },
  });

  assert.equal(result.offline, true);
  assert.equal(
    result.payload.summary.lines.at(-1),
    "Offline: network unreachable. Sequence 0 is a placeholder; do not submit this transaction.",
  );
  assert.equal(typeof result.payload.xdr, "string");
  assert.ok(result.payload.xdr.length > 0);
});

test("a wrong-typed sequence is an error, never a silent offline fallback", async () => {
  await assert.rejects(
    buildUnsignedPayload({
      owner: OWNER,
      destination: DESTINATION,
      horizonUrl: HORIZON_URL,
      networkPassphrase: PASSPHRASE,
      loadAccount: async () => ({ sequenceNumber: () => 12345 }),
    }),
    /sequenceNumber must be a numeric string/,
  );
});

test("parses bare and name-prefixed alias entries down to addresses", () => {
  assert.deepEqual(parseAliases(`${OWNER}, acc2=${DESTINATION}`), [OWNER, DESTINATION]);
  assert.deepEqual(parseAliases(`  acc2=${DESTINATION}  `), [DESTINATION]);
  assert.deepEqual(parseAliases(""), []);
  assert.deepEqual(parseAliases(undefined), []);
});
