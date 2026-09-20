import { Account, Asset, BASE_FEE, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { TESTNET_PASSPHRASE } from "../../anchor/config.ts";
import { buildPaymentSummary, formatAmount, payloadHashOf, stroopsToXlm, toHex } from "../summary.ts";
import { ADA, baseIntent, makeDeps, OWNER, runPayment } from "./helpers.ts";

/**
 * One fixed envelope — the deterministic payment `makeDeps()` + `baseIntent`
 * build — and its two hashes. `XDR_FIXTURE_TX_HASH` is the Stellar transaction
 * hash (`Transaction.hash()`); `XDR_FIXTURE_DIGEST` is the agent seam's XDR
 * digest (SHA-256 of the base64 string). They are different values; the agent
 * suite (`agent/src/execution.test.ts`) pins the same fixture, so a swap fails in
 * either place (M-1).
 */
const XDR_FIXTURE =
  "AAAAAgAAAACWE1NPjv0inU+SO2ece8tfmKLpxA1Koj58eR9H1N3a0wAAAGQAAAAAAAAD6QAAAAEAAAAAAAAAAAAAAABqrnpsAAAAAAAAAAEAAAAAAAAAAQAAAAAje1WiTrVNOjrawB7nsbI1cqE5BqO5xeWilY91MM5cSwAAAAFVU0RDAAAAAEI+fQXy7K+/7BkrIVo/G+lq7bjY5wJUq+NBPgIH3layAAAAAAX14QAAAAAAAAAAAA==";
const XDR_FIXTURE_TX_HASH = "2f38a676d5ed29dad5043f5f105fe78c7fb355a4dd1bfc56c5e90ae33df33a2a";
const XDR_FIXTURE_DIGEST = "c1d5910a3bfed5a4841a56863cc3ad92b9ff4d4b556c35ffd14ab4daab10192f";

describe("summary helpers", () => {
  it("toHex encodes bytes without Buffer", () => {
    expect(toHex(new Uint8Array([0, 255, 16]))).toBe("00ff10");
    expect(toHex(new Uint8Array([]))).toBe("");
  });

  it("pin the fixed fixture: the tx hash is not the agent's XDR digest", async () => {
    const res = await runPayment(makeDeps(), baseIntent);
    expect(res.unsignedXdr).toBe(XDR_FIXTURE);
    expect(payloadHashOf(XDR_FIXTURE, TESTNET_PASSPHRASE)).toBe(XDR_FIXTURE_TX_HASH);
    expect(XDR_FIXTURE_TX_HASH).not.toBe(XDR_FIXTURE_DIGEST);
  });

  it("stroopsToXlm trims trailing zeros", () => {
    expect(stroopsToXlm("100")).toBe("0.00001");
    expect(stroopsToXlm("10000000")).toBe("1");
    expect(stroopsToXlm("12345678")).toBe("1.2345678");
    expect(stroopsToXlm("1")).toBe("0.0000001");
  });

  it("formatAmount trims the canonical XDR padding", () => {
    expect(formatAmount("10.0000000")).toBe("10");
    expect(formatAmount("0.0000001")).toBe("0.0000001");
    expect(formatAmount("999999999999.9999999")).toBe("999999999999.9999999");
    expect(formatAmount("7")).toBe("7");
  });
});

describe("buildPaymentSummary", () => {
  it("decodes the XDR and reports the same payload hash as payloadHashOf", async () => {
    const res = await runPayment(makeDeps(), baseIntent);
    const built = buildPaymentSummary({
      unsignedXdr: res.unsignedXdr,
      networkPassphrase: TESTNET_PASSPHRASE,
      alias: "ada",
    });
    expect(built.payloadHash).toBe(payloadHashOf(res.unsignedXdr, TESTNET_PASSPHRASE));
    expect(built.summary).toEqual(res.summary);
  });

  it("rejects a transaction whose first operation is not a payment", () => {
    const xdr = new TransactionBuilder(new Account(OWNER, "1000"), {
      fee: BASE_FEE,
      networkPassphrase: TESTNET_PASSPHRASE,
    })
      .addOperation(Operation.bumpSequence({ bumpTo: "1" }))
      .addOperation(Operation.payment({ destination: ADA, asset: Asset.native(), amount: "1" }))
      .setTimeout(300)
      .build()
      .toXDR();
    expect(() => buildPaymentSummary({ unsignedXdr: xdr, networkPassphrase: TESTNET_PASSPHRASE, alias: "ada" })).toThrow(
      /not a payment/,
    );
  });

  it("rejects a fee-bump envelope", () => {
    const inner = new TransactionBuilder(new Account(OWNER, "1000"), {
      fee: BASE_FEE,
      networkPassphrase: TESTNET_PASSPHRASE,
    })
      .addOperation(Operation.payment({ destination: ADA, asset: Asset.native(), amount: "1" }))
      .setTimeout(300)
      .build();
    const xdr = TransactionBuilder.buildFeeBumpTransaction(OWNER, BASE_FEE, inner, TESTNET_PASSPHRASE).toXDR();
    expect(() => buildPaymentSummary({ unsignedXdr: xdr, networkPassphrase: TESTNET_PASSPHRASE, alias: "ada" })).toThrow(
      /fee-bump envelopes are not supported/,
    );
  });
});
