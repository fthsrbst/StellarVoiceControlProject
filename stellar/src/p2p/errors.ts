/**
 * Typed, machine-readable errors for the P2P client.
 *
 * The `polaris_p2p_escrow` contract is written in parallel and its numeric
 * error codes are not frozen here, so a simulation failure is surfaced as a
 * `P2pRefusal` with the raw host message rather than a guessed contract code.
 * Callers must match on `code`, never on the human `message`.
 */

export type P2pRefusalCode =
  | "not_configured"
  | "invalid_intent"
  | "invalid_amount"
  | "invalid_price"
  | "offer_not_found"
  | "simulation_failed";

/** A typed P2P failure. `details` is advisory context. */
export class P2pRefusal extends Error {
  readonly code: P2pRefusalCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(code: P2pRefusalCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "P2pRefusal";
    this.code = code;
    this.details = details;
  }
}

export function isP2pRefusal(value: unknown): value is P2pRefusal {
  return value instanceof P2pRefusal;
}

/** Wraps any thrown value as a typed refusal (transport failures included). */
export function asP2pRefusal(error: unknown): P2pRefusal {
  if (isP2pRefusal(error)) return error;
  return new P2pRefusal(
    "simulation_failed",
    error instanceof Error ? error.message : String(error),
  );
}
