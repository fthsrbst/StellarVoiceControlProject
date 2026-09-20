/**
 * Signed-XDR verification for the bridge (W4a).
 *
 * After the wallet returns a signed envelope we do not trust it blindly: it must
 * be a well-formed transaction for the same network, carry a signature made by
 * the expected address, and — most importantly — be the *same transaction* we
 * handed to the wallet. The last point is proved by comparing the two envelopes'
 * signature-base hashes, which commit to source, fee, sequence, time bounds,
 * memo and every operation; a wallet that returns a different transaction (even
 * with the same source and operation count) fails here.
 *
 * `@stellar/stellar-sdk` recomputes the network-specific transaction hash from
 * `networkPassphrase`, so a signature made for another network will not verify.
 *
 * Browser-safe: no Node `Buffer` global; hex is produced by a local helper.
 */
import { Keypair, Transaction, TransactionBuilder, hash as sha256 } from "@stellar/stellar-sdk";

export interface VerifySignedXdrInput {
  /** The envelope the wallet returned. */
  signedXdr: string;
  /** The envelope we handed to the wallet. */
  unsignedXdr: string;
  networkPassphrase: string;
  /** Expected signer (G address). */
  address: string;
  /**
   * Optional consistency token from the payload. When present it must be a hex
   * digest of the unsigned XDR: either the transaction signature-base hash
   * (`tx.hash()`, what the approval flow emits) or the SHA-256 of the base64 XDR
   * string (the W4b contract). Both commit to the exact transaction bytes; any
   * other value is rejected.
   */
  payloadHash?: string;
}

export type VerifySignedXdrResult = { ok: true } | { ok: false; reason: string };

/** Lowercase hex of arbitrary bytes, without the Node `Buffer` global. */
function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
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

  // Fee-bump envelopes are not built by the bridge; refusing them keeps the
  // comparison below on one, unambiguous hash definition.
  if (!(unsigned instanceof Transaction)) {
    return { ok: false, reason: "the unsigned envelope is not a plain transaction" };
  }
  if (!(signed instanceof Transaction)) {
    return { ok: false, reason: "the signed envelope is not a plain transaction" };
  }

  if (signed.source !== unsigned.source) {
    return { ok: false, reason: "the signed transaction has a different source account" };
  }
  if (signed.operations.length !== unsigned.operations.length) {
    return { ok: false, reason: "the signed transaction has a different operation count" };
  }

  const unsignedHash = toHex(unsigned.hash());
  if (toHex(signed.hash()) !== unsignedHash) {
    return { ok: false, reason: "the signed transaction is not the unsigned transaction" };
  }

  // Secondary consistency check: the payload hash binds the envelope to what the
  // approval flow displayed. `sha256(input)` hashes the UTF-8 bytes of the base64
  // XDR string.
  if (
    input.payloadHash &&
    input.payloadHash !== unsignedHash &&
    input.payloadHash !== toHex(sha256(input.unsignedXdr))
  ) {
    return { ok: false, reason: "the payload hash does not match the unsigned transaction" };
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
