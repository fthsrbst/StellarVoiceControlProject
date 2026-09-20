import assert from "node:assert/strict";
import { test } from "node:test";

import {
  Account,
  Asset,
  BASE_FEE,
  Keypair,
  Memo,
  Operation,
  Transaction,
  TransactionBuilder,
  hash as sha256,
} from "@stellar/stellar-sdk";

import { TESTNET_PASSPHRASE, makePayloadFixture, signXdr } from "./fixtures.ts";
import { verifySignedXdr } from "./verify.ts";

/** Builds one unsigned payment with the same source, optionally differing in one field. */
function buildVariant(
  source: string,
  options: {
    destination?: string;
    amount?: string;
    sequence?: string;
    fee?: string;
    memo?: Memo;
    timeoutSeconds?: number;
  } = {},
): string {
  const account = new Account(source, options.sequence ?? "0");
  const builder = new TransactionBuilder(account, {
    fee: options.fee ?? BASE_FEE,
    networkPassphrase: TESTNET_PASSPHRASE,
  }).addOperation(
    Operation.payment({
      destination: options.destination ?? Keypair.random().publicKey(),
      asset: Asset.native(),
      amount: options.amount ?? "1",
    }),
  );
  if (options.memo) builder.addMemo(options.memo);
  return builder.setTimeout(options.timeoutSeconds ?? 180).build().toXDR();
}

test("a signature by the expected address verifies", () => {
  const { payload, owner } = makePayloadFixture();
  const result = verifySignedXdr({
    signedXdr: signXdr(payload.xdr, owner),
    unsignedXdr: payload.xdr,
    networkPassphrase: payload.networkPassphrase,
    address: payload.address,
    payloadHash: payload.payloadHash,
  });
  assert.deepEqual(result, { ok: true });
});

test("a SHA-256-of-the-XDR payload hash is also accepted", () => {
  const { payload, owner } = makePayloadFixture();
  const result = verifySignedXdr({
    signedXdr: signXdr(payload.xdr, owner),
    unsignedXdr: payload.xdr,
    networkPassphrase: payload.networkPassphrase,
    address: payload.address,
    payloadHash: Buffer.from(sha256(payload.xdr)).toString("hex"),
  });
  assert.deepEqual(result, { ok: true });
});

test("a tampered payload hash is rejected", () => {
  const { payload, owner } = makePayloadFixture();
  const result = verifySignedXdr({
    signedXdr: signXdr(payload.xdr, owner),
    unsignedXdr: payload.xdr,
    networkPassphrase: payload.networkPassphrase,
    address: payload.address,
    payloadHash: "0".repeat(64),
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /payload hash/);
});

test("a malformed signed envelope is rejected", () => {
  const { payload } = makePayloadFixture();
  const result = verifySignedXdr({
    signedXdr: "not-an-xdr",
    unsignedXdr: payload.xdr,
    networkPassphrase: payload.networkPassphrase,
    address: payload.address,
  });
  assert.equal(result.ok, false);
});

test("a signature by a different key is rejected", () => {
  const { payload } = makePayloadFixture();
  const result = verifySignedXdr({
    signedXdr: signXdr(payload.xdr, Keypair.random()),
    unsignedXdr: payload.xdr,
    networkPassphrase: payload.networkPassphrase,
    address: payload.address,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /no valid signature/);
});

test("a transaction with a different source is rejected", () => {
  const { payload, owner, destination } = makePayloadFixture();
  const otherSource = new Account(Keypair.random().publicKey(), "0");
  const otherXdr = new TransactionBuilder(otherSource, {
    fee: BASE_FEE,
    networkPassphrase: TESTNET_PASSPHRASE,
  })
    .addOperation(
      Operation.payment({ destination: destination.publicKey(), asset: Asset.native(), amount: "1" }),
    )
    .setTimeout(180)
    .build()
    .toXDR();

  const result = verifySignedXdr({
    signedXdr: signXdr(otherXdr, owner),
    unsignedXdr: payload.xdr,
    networkPassphrase: payload.networkPassphrase,
    address: payload.address,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /source account/);
});

test("a transaction with a different operation count is rejected", () => {
  const { payload, owner, destination } = makePayloadFixture();
  const account = new Account(payload.address, "0");
  const twoOpXdr = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: TESTNET_PASSPHRASE,
  })
    .addOperation(
      Operation.payment({ destination: destination.publicKey(), asset: Asset.native(), amount: "1" }),
    )
    .addOperation(
      Operation.payment({ destination: destination.publicKey(), asset: Asset.native(), amount: "2" }),
    )
    .setTimeout(180)
    .build()
    .toXDR();

  const result = verifySignedXdr({
    signedXdr: signXdr(twoOpXdr, owner),
    unsignedXdr: payload.xdr,
    networkPassphrase: payload.networkPassphrase,
    address: payload.address,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /operation count/);
});

// Regression tests for the review's BLOCKER: the wallet returning a different
// transaction with the same source and the same operation count must be caught.
// Every case below was accepted by the pre-fix verifier.
test("a same-source, same-op-count transaction to a different destination is rejected", () => {
  const { payload, owner } = makePayloadFixture();
  const variant = buildVariant(payload.address, { destination: Keypair.random().publicKey() });
  const result = verifySignedXdr({
    signedXdr: signXdr(variant, owner),
    unsignedXdr: payload.xdr,
    networkPassphrase: payload.networkPassphrase,
    address: payload.address,
    payloadHash: payload.payloadHash,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /not the unsigned transaction/);
});

test("a same-source, same-op-count transaction with a different amount is rejected", () => {
  const { payload, owner } = makePayloadFixture();
  const variant = buildVariant(payload.address, { amount: "100" });
  const result = verifySignedXdr({
    signedXdr: signXdr(variant, owner),
    unsignedXdr: payload.xdr,
    networkPassphrase: payload.networkPassphrase,
    address: payload.address,
    payloadHash: payload.payloadHash,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /not the unsigned transaction/);
});

test("a same-source, same-op-count transaction with a different sequence is rejected", () => {
  const { payload, owner } = makePayloadFixture();
  const variant = buildVariant(payload.address, { sequence: "42" });
  const result = verifySignedXdr({
    signedXdr: signXdr(variant, owner),
    unsignedXdr: payload.xdr,
    networkPassphrase: payload.networkPassphrase,
    address: payload.address,
    payloadHash: payload.payloadHash,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /not the unsigned transaction/);
});

test("a same-source, same-op-count transaction with a different fee is rejected", () => {
  const { payload, owner } = makePayloadFixture();
  const variant = buildVariant(payload.address, { fee: "200" });
  const result = verifySignedXdr({
    signedXdr: signXdr(variant, owner),
    unsignedXdr: payload.xdr,
    networkPassphrase: payload.networkPassphrase,
    address: payload.address,
    payloadHash: payload.payloadHash,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /not the unsigned transaction/);
});

test("a same-source, same-op-count transaction with a different memo is rejected", () => {
  const { payload, owner } = makePayloadFixture();
  const variant = buildVariant(payload.address, { memo: Memo.text("memo") });
  const result = verifySignedXdr({
    signedXdr: signXdr(variant, owner),
    unsignedXdr: payload.xdr,
    networkPassphrase: payload.networkPassphrase,
    address: payload.address,
    payloadHash: payload.payloadHash,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /not the unsigned transaction/);
});

test("a same-source, same-op-count transaction with different time bounds is rejected", () => {
  const { payload, owner } = makePayloadFixture();
  const variant = buildVariant(payload.address, { timeoutSeconds: 3600 });
  const result = verifySignedXdr({
    signedXdr: signXdr(variant, owner),
    unsignedXdr: payload.xdr,
    networkPassphrase: payload.networkPassphrase,
    address: payload.address,
    payloadHash: payload.payloadHash,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /not the unsigned transaction/);
});

test("a fee-bump signed envelope is rejected", () => {
  const { payload, owner } = makePayloadFixture();
  const inner = TransactionBuilder.fromXDR(payload.xdr, payload.networkPassphrase) as Transaction;
  const feeBump = TransactionBuilder.buildFeeBumpTransaction(
    owner,
    BASE_FEE,
    inner,
    payload.networkPassphrase,
  );
  feeBump.sign(owner);

  const result = verifySignedXdr({
    signedXdr: feeBump.toXDR(),
    unsignedXdr: payload.xdr,
    networkPassphrase: payload.networkPassphrase,
    address: payload.address,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /plain transaction/);
});
