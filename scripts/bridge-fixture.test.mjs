// Regression tests for the fixture's live Horizon payload path, plus tests that
// pin the fixture's signature verification to the page's `verifySignedXdr`.
//
// The Horizon bug: an `AccountResponse` exposes `sequenceNumber` as a *method*,
// so passing `account.sequenceNumber` straight into `new Account(...)` made the
// SDK throw "sequence must be of type string" whenever Horizon was reachable.
// The injectable loader lets these tests exercise that path without a network.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Account, Asset, BASE_FEE, Keypair, Operation, TransactionBuilder } from "@stellar/stellar-sdk";

import { buildUnsignedPayload, parseAliases, verifySigned } from "./bridge-fixture.mjs";
import { verifySignedXdr } from "../app/src/bridge/verify.ts";

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

/** Signs and re-encodes an envelope. */
function signXdr(xdr, ...signers) {
  const transaction = TransactionBuilder.fromXDR(xdr, PASSPHRASE);
  transaction.sign(...signers);
  return transaction.toXDR();
}

/** One unsigned payment, for building a transaction that differs from the payload. */
function paymentXdr(source, destination, { sequence = "0", amount = "1", fee = BASE_FEE } = {}) {
  return new TransactionBuilder(new Account(source, sequence), {
    fee,
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(Operation.payment({ destination, asset: Asset.native(), amount }))
    .setTimeout(180)
    .build()
    .toXDR();
}

/** Runs the same input through the fixture verifier and the page verifier. */
function verifyBoth({ signedXdr, payload, owner }) {
  const fixture = verifySigned({
    signedXdr,
    unsignedXdr: payload.xdr,
    payloadHash: payload.payloadHash,
    networkPassphrase: PASSPHRASE,
    owner: owner.publicKey(),
  });
  const page = verifySignedXdr({
    signedXdr,
    unsignedXdr: payload.xdr,
    payloadHash: payload.payloadHash,
    networkPassphrase: PASSPHRASE,
    address: owner.publicKey(),
  });
  return { fixture, page };
}

test("the fixture verifier accepts an honest owner signature and matches the payload hash", async () => {
  const owner = Keypair.random();
  const { payload } = await buildUnsignedPayload({
    owner: owner.publicKey(),
    destination: Keypair.random().publicKey(),
    horizonUrl: null,
    networkPassphrase: PASSPHRASE,
  });

  const { fixture, page } = verifyBoth({ signedXdr: signXdr(payload.xdr, owner), payload, owner });

  assert.equal(fixture.verified, true);
  assert.equal(fixture.hash, payload.payloadHash);
  assert.equal(page.ok, true);
});

test("both verifiers reject a different transaction with the same source and op count", async () => {
  const owner = Keypair.random();
  const { payload } = await buildUnsignedPayload({
    owner: owner.publicKey(),
    destination: Keypair.random().publicKey(),
    horizonUrl: null,
    networkPassphrase: PASSPHRASE,
  });
  const swapped = paymentXdr(owner.publicKey(), Keypair.random().publicKey(), {
    sequence: "999",
    amount: "100",
    fee: "200",
  });

  const { fixture, page } = verifyBoth({ signedXdr: signXdr(swapped, owner), payload, owner });

  assert.equal(fixture.verified, false);
  assert.match(fixture.reason, /not the unsigned transaction/);
  assert.equal(page.ok, false);
});

test("the two verifiers agree on the same fixtures", async () => {
  const owner = Keypair.random();
  const destination = Keypair.random();
  const { payload } = await buildUnsignedPayload({
    owner: owner.publicKey(),
    destination: destination.publicKey(),
    horizonUrl: null,
    networkPassphrase: PASSPHRASE,
  });
  const scenarios = {
    honest: signXdr(payload.xdr, owner),
    differentDestination: signXdr(paymentXdr(owner.publicKey(), Keypair.random().publicKey()), owner),
    differentAmount: signXdr(paymentXdr(owner.publicKey(), destination.publicKey(), { amount: "5" }), owner),
    differentSequence: signXdr(paymentXdr(owner.publicKey(), destination.publicKey(), { sequence: "7" }), owner),
    wrongSigner: signXdr(payload.xdr, Keypair.random()),
  };

  for (const [name, signedXdr] of Object.entries(scenarios)) {
    const { fixture, page } = verifyBoth({ signedXdr, payload, owner });
    assert.equal(fixture.verified, page.ok, `${name}: fixture=${fixture.verified} page=${page.ok}`);
  }
});

test("the fixture verifier rejects a tampered payload hash", async () => {
  const owner = Keypair.random();
  const { payload } = await buildUnsignedPayload({
    owner: owner.publicKey(),
    destination: Keypair.random().publicKey(),
    horizonUrl: null,
    networkPassphrase: PASSPHRASE,
  });

  const result = verifySigned({
    signedXdr: signXdr(payload.xdr, owner),
    unsignedXdr: payload.xdr,
    payloadHash: "0".repeat(64),
    networkPassphrase: PASSPHRASE,
    owner: owner.publicKey(),
  });

  assert.equal(result.verified, false);
  assert.match(result.reason, /payload hash/);
});
