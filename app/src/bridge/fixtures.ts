/**
 * Shared test fixtures for the bridge (W4a). Everything here is offline: real
 * keypairs and real envelopes built in memory, no network and no wallet.
 */
import { Account, Asset, BASE_FEE, Keypair, Operation, TransactionBuilder } from "@stellar/stellar-sdk";

import type { BridgePayload, BridgeSummary } from "./types.ts";

export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

export const SAMPLE_SUMMARY: BridgeSummary = {
  title: "Sign a testnet payment",
  lines: ["From G…OWNER", "To G…DESTINATION", "Amount 1 XLM"],
  estimatedFee: "0.0000100 XLM",
};

/** Builds one unsigned native-XLM payment envelope. */
export function buildUnsignedXdr(source: string, destination: string): string {
  const account = new Account(source, "0");
  return new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: TESTNET_PASSPHRASE })
    .addOperation(
      Operation.payment({ destination, asset: Asset.native(), amount: "1" }),
    )
    .setTimeout(180)
    .build()
    .toXDR();
}

/** Signs an existing envelope and re-encodes it. */
export function signXdr(xdr: string, ...signers: Keypair[]): string {
  const tx = TransactionBuilder.fromXDR(xdr, TESTNET_PASSPHRASE);
  tx.sign(...signers);
  return tx.toXDR();
}

export interface PayloadFixture {
  payload: BridgePayload;
  owner: Keypair;
  destination: Keypair;
}

/** A deterministic-shape payload whose source is a fresh random keypair. */
export function makePayloadFixture(overrides: Partial<BridgePayload> = {}): PayloadFixture {
  const owner = Keypair.random();
  const destination = Keypair.random();
  const xdr = buildUnsignedXdr(owner.publicKey(), destination.publicKey());
  const hash = Buffer.from(TransactionBuilder.fromXDR(xdr, TESTNET_PASSPHRASE).hash()).toString("hex");

  const payload: BridgePayload = {
    xdr,
    networkPassphrase: TESTNET_PASSPHRASE,
    address: owner.publicKey(),
    payloadHash: hash,
    summary: SAMPLE_SUMMARY,
    ...overrides,
  };
  return { payload, owner, destination };
}
