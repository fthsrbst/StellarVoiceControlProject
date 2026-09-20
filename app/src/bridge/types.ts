/**
 * Wire types for the Freighter signing bridge (W4a).
 *
 * These mirror the contract the W4b localhost server implements; do not change
 * one without the other. The page is opened at
 * `http://127.0.0.1:<port>/sign?t=<token>` and talks only to that origin.
 */

/** Codes the page may post back when it could not produce a signature. */
export type BridgeErrorCode =
  | "rejected"
  | "address_mismatch"
  | "network_mismatch"
  | "wallet_unavailable"
  | "error";

/** Human-readable description of what is being signed, shown before any prompt. */
export interface BridgeSummary {
  title: string;
  lines: string[];
  estimatedFee: string;
  explorerUrl?: string;
}

/** `GET /sign/payload?t=<token>` response: the one unsigned XDR to sign. */
export interface BridgePayload {
  /** Base64 transaction envelope, unsigned. */
  xdr: string;
  networkPassphrase: string;
  /** The G address the transaction's source must be signed by. */
  address: string;
  /**
   * Optional hex digest of the unsigned XDR shown on the approval card. The page
   * accepts either the transaction signature-base hash (`tx.hash()`, what the
   * approval flow emits) or the SHA-256 of the base64 XDR string (W4b); see
   * `docs/freighter-bridge.md` §2.
   */
  payloadHash?: string;
  summary: BridgeSummary;
}

/** `POST /sign/result?t=<token>` body. */
export type BridgeResult =
  | { ok: true; signedXdr: string; signerAddress: string }
  | { ok: false; code: BridgeErrorCode; error: string };

/** The state machine the UI renders, in order. */
export type SignFlowStatus =
  | "loading"
  | "connecting"
  | "awaiting_signature"
  | "signed"
  | "rejected"
  | "error"
  | "expired";

/**
 * A renderable snapshot. Kept as one flat shape (rather than a discriminated
 * union) because the UI switches on `status` and then reads the optional parts.
 */
export interface SignFlowState {
  status: SignFlowStatus;
  payload?: BridgePayload;
  /** The wallet address that connected, once known. */
  address?: string;
  signedXdr?: string;
  /** Present when `status` is `rejected` or `error`. */
  code?: BridgeErrorCode;
  error?: string;
}

/** One row of the `debug=1` protocol log. Never contains the token or secret. */
export interface DebugEntry {
  step: string;
  at: number;
  detail: string;
}
