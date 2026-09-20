import assert from "node:assert/strict";
import { test } from "node:test";

import {
  Account,
  Asset,
  Operation,
  TimeoutInfinite,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { TESTNET } from "@polaris/stellar";

import {
  AnchorSigningUnavailableError,
  classifyAnchorTx,
  createAnchorSigner,
  isMissingCommandError,
} from "./anchor.ts";
import type { BridgeOutcome } from "./signing.ts";

const OWNER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const SIGNED = "SIGNED-ENVELOPE";

/** Builds an envelope with the given integer sequence (builder emits sequence + 1). */
function xdrWithSequence(sequence: string, op: (b: TransactionBuilder) => void): string {
  const builder = new TransactionBuilder(new Account(OWNER, sequence), {
    fee: "100",
    networkPassphrase: TESTNET.networkPassphrase,
  });
  op(builder);
  return builder.setTimeout(TimeoutInfinite).build().toXDR();
}

/** A sequence-0 login challenge (builder at -1 emits 0). */
function challengeXdr(): string {
  return xdrWithSequence("-1", (b) => {
    b.addOperation(Operation.manageData({ name: "home.test auth", value: "nonce" }));
  });
}

/** A non-zero payment (builder at 1 emits 2). */
function paymentXdr(): string {
  return xdrWithSequence("1", (b) => {
    b.addOperation(Operation.payment({ destination: OWNER, asset: Asset.native(), amount: "1" }));
  });
}

function signedOk(): BridgeOutcome {
  return { ok: true, signedXdr: SIGNED, signerAddress: OWNER, txHash: "a".repeat(64) };
}

test("classifyAnchorTx flags a sequence-0 challenge and never builds a summary from it", () => {
  const facts = classifyAnchorTx(challengeXdr());
  assert.equal(facts.isChallenge, true);
  assert.equal(facts.intent.kind, "raw_tx");
});

test("classifyAnchorTx reads a payment as a withdraw intent with a decoded summary", () => {
  const facts = classifyAnchorTx(paymentXdr());
  assert.equal(facts.isChallenge, false);
  assert.equal(facts.intent.kind, "withdraw");
  // The SDK normalises the operation amount to its 7-decimal form.
  assert.equal(Number(facts.intent.amount), 1);
  assert.match(facts.summary.lines.join(" "), /Pay 1\.0+ XLM/);
});

test("createAnchorSigner routes a sequence-0 challenge to the wallet-only signer", async () => {
  const seen: string[] = [];
  const signer = createAnchorSigner({
    owner: async () => OWNER,
    signChallenge: async (xdr) => {
      seen.push(xdr);
      return signedOk();
    },
    signViaPipeline: async () => assert.fail("the pipeline must not run for a challenge"),
  });
  assert.equal(await signer.publicKey(), OWNER);
  assert.equal(await signer.signTransaction(challengeXdr(), { networkPassphrase: TESTNET.networkPassphrase }), SIGNED);
  assert.equal(seen.length, 1);
});

test("createAnchorSigner routes every other transaction through the Touch ID pipeline", async () => {
  let pipelineXdr: string | undefined;
  const signer = createAnchorSigner({
    owner: async () => OWNER,
    signChallenge: async () => assert.fail("the challenge signer must not run"),
    signViaPipeline: async (result) => {
      pipelineXdr = result.unsignedXdr;
      return SIGNED;
    },
  });
  const xdr = paymentXdr();
  assert.equal(await signer.signTransaction(xdr, { networkPassphrase: TESTNET.networkPassphrase }), SIGNED);
  assert.equal(pipelineXdr, xdr);
});

test("a wallet refusal on the challenge is a labelled error, never an unsigned envelope", async () => {
  const signer = createAnchorSigner({
    owner: async () => OWNER,
    signChallenge: async () => ({ ok: false, code: "rejected", message: "user cancelled" }),
    signViaPipeline: async () => assert.fail("the pipeline must not run"),
  });
  await assert.rejects(
    () => signer.signTransaction(challengeXdr(), { networkPassphrase: TESTNET.networkPassphrase }),
    /did not sign the anchor login challenge/,
  );
});

test("a missing bridge_sign_challenge command surfaces as AnchorSigningUnavailableError", async () => {
  const signer = createAnchorSigner({
    owner: async () => OWNER,
    signChallenge: async () => {
      throw new AnchorSigningUnavailableError("bridge_sign_challenge is not present on this build yet");
    },
    signViaPipeline: async () => assert.fail("the pipeline must not run"),
  });
  await assert.rejects(
    () => signer.signTransaction(challengeXdr(), { networkPassphrase: TESTNET.networkPassphrase }),
    AnchorSigningUnavailableError,
  );
});

test("isMissingCommandError only matches the missing-command shape", () => {
  assert.equal(isMissingCommandError("Command bridge_sign_challenge not found"), true);
  assert.equal(isMissingCommandError(new Error("unknown command bridge_sign_challenge")), true);
  assert.equal(isMissingCommandError(new Error("network request failed")), false);
});
