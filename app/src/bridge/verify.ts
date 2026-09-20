/**
 * Signed-XDR verification for the bridge (W4a).
 *
 * After the wallet returns a signed envelope we do not trust it blindly: the
 * envelope must be a well-formed transaction for the same network, with the
 * same source and operation count as the input, and must actually carry a
 * signature made by the expected address.
 *
 * `@stellar/stellar-sdk` recomputes the network-specific transaction hash from
 * `networkPassphrase`, so a signature made for another network will not verify.
 */
import { FeeBumpTransaction, Keypair, TransactionBuilder } from "@stellar/stellar-sdk";

export interface VerifySignedXdrInput {
  /** The envelope the wallet returned. */
  signedXdr: string;
  /** The envelope we handed to the wallet. */
  unsignedXdr: string;
  networkPassphrase: string;
  /** Expected signer (G address). */
  address: string;
}

export type VerifySignedXdrResult = { ok: true } | { ok: false; reason: string };

function sourceOf(tx: ReturnType<typeof TransactionBuilder.fromXDR>): string {
  return tx instanceof FeeBumpTransaction ? tx.innerTransaction.source : tx.source;
}

function operationCount(tx: ReturnType<typeof TransactionBuilder.fromXDR>): number {
  return (tx instanceof FeeBumpTransaction ? tx.innerTransaction : tx).operations.length;
}

/** Verifies a signed envelope against the unsigned input, never throwing. */
export function verifySignedXdr(input: VerifySignedXdrInput): VerifySignedXdrResult {
  let signed: ReturnType<typeof TransactionBuilder.fromXDR>;
  try {
    signed = TransactionBuilder.fromXDR(input.signedXdr, input.networkPassphrase);
  } catch {
    return { ok: false, reason: "the signed XDR is malformed" };
  }

  let unsigned: ReturnType<typeof TransactionBuilder.fromXDR>;
  try {
    unsigned = TransactionBuilder.fromXDR(input.unsignedXdr, input.networkPassphrase);
  } catch {
    return { ok: false, reason: "the unsigned XDR is malformed" };
  }

  if (sourceOf(signed) !== sourceOf(unsigned)) {
    return { ok: false, reason: "the signed transaction has a different source account" };
  }
  if (operationCount(signed) !== operationCount(unsigned)) {
    return { ok: false, reason: "the signed transaction has a different operation count" };
  }

  let signer: Keypair;
  try {
    signer = Keypair.fromPublicKey(input.address);
  } catch {
    return { ok: false, reason: `not a valid account address: ${input.address}` };
  }

  const hash = signed.hash();
  const matched = signed.signatures.some((signature) => {
    try {
      return signer.verify(hash, signature.signature);
    } catch {
      return false;
    }
  });

  if (!matched) {
    return { ok: false, reason: `no valid signature by ${input.address} on the transaction` };
  }
  return { ok: true };
}
