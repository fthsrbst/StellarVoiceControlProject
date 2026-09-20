import assert from "node:assert/strict";
import { test } from "node:test";

import {
  Account,
  Asset,
  BASE_FEE,
  Keypair,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

import { TESTNET_PASSPHRASE, makePayloadFixture, signXdr } from "./fixtures.ts";
import { verifySignedXdr } from "./verify.ts";

test("a signature by the expected address verifies", () => {
  const { payload, owner } = makePayloadFixture();
  const result = verifySignedXdr({
    signedXdr: signXdr(payload.xdr, owner),
    unsignedXdr: payload.xdr,
    networkPassphrase: payload.networkPassphrase,
    address: payload.address,
  });
  assert.deepEqual(result, { ok: true });
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
