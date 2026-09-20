/**
 * Pure view models for the P2P panel (W8).
 *
 * Kept free of React and Tauri so the state machine — who may do what to an
 * offer at which moment — is unit-tested under `node:test`. The panel renders
 * these rows; it never decides an action itself.
 *
 * The escrow only ever holds the sold token. The TRY leg is off-chain: Polaris
 * cannot see it, so the seller is the only one who can confirm it arrived. That
 * is exactly why `confirm` is offered to the seller only.
 */
import type { Offer, OfferState } from "@polaris/stellar";

/** Raw token units per whole token (the demo stablecoin uses 7 decimals). */
export const RAW_UNITS_PER_TOKEN = 10_000_000n;
/** Kurus per Turkish lira. */
export const KURUS_PER_LIRA = 100n;

/** Whose side of an offer the viewer is on. */
export type P2pRole = "seller" | "buyer" | "other";

/** The next on-chain action the viewer may take, if any. */
export type P2pAction = "accept" | "confirm" | "cancel" | "reclaim" | "wait" | "none";

/** A decoded offer, formatted for one table row. */
export interface OfferView {
  id: bigint;
  state: OfferState;
  seller: string;
  sellerLabel: string;
  buyer: string | null;
  amount: string;
  priceTry: string;
  /** TRY per whole token, e.g. `"34 TRY/USDC"`. */
  rate: string;
  /** `expires_at` in Unix seconds. */
  expiresAt: number;
  /** Human "expires in" label, or `"expired"`. */
  expiresIn: string;
  role: P2pRole;
  next: P2pAction;
}

/** `GABC…WXYZ` for compact display. */
export function shortAddress(address: string): string {
  return address.length > 8 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

/** Raw token units -> trimmed decimal string (`10000000000n` -> `"1000"`). */
export function formatTokenAmount(raw: bigint): string {
  const whole = raw / RAW_UNITS_PER_TOKEN;
  const frac = (raw % RAW_UNITS_PER_TOKEN).toString().padStart(7, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** Kurus -> trimmed TRY decimal string (`340050n` -> `"3400.5"`). */
export function formatTry(kurus: bigint): string {
  const whole = kurus / KURUS_PER_LIRA;
  const frac = (kurus % KURUS_PER_LIRA).toString().padStart(2, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** TRY-per-token rate for a whole token; `"?"` when the amount is zero. */
export function formatRate(amountRaw: bigint, priceKurus: bigint): string {
  if (amountRaw <= 0n) return "?";
  const kurusPerToken = (priceKurus * RAW_UNITS_PER_TOKEN) / amountRaw;
  return `${formatTry(kurusPerToken)} TRY/token`;
}

function plural(value: number, unit: string): string {
  return `${value}${unit}`;
}

/** Human countdown, or `"expired"` once `expiresAt` is in the past. */
export function formatExpiresIn(expiresAt: number, nowSeconds: number): string {
  const seconds = expiresAt - nowSeconds;
  if (seconds <= 0) return "expired";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${plural(days, "d")} ${plural(hours, "h")}`;
  if (hours > 0) return `${plural(hours, "h")} ${plural(minutes, "m")}`;
  return `${Math.max(1, minutes)}m`;
}

/** Which side of the offer the viewer is on. */
export function roleOf(offer: Offer, owner: string | null): P2pRole {
  if (owner && offer.seller === owner) return "seller";
  if (owner && offer.buyer === owner) return "buyer";
  return "other";
}

/**
 * The single action the viewer may take next, derived from the contract state
 * and the viewer's role. `wait` means the flow is in someone else's hands
 * (the buyer must pay TRY off-chain before the seller confirms).
 */
export function nextAction(offer: Offer, owner: string | null, nowSeconds: number): P2pAction {
  const role = roleOf(offer, owner);
  switch (offer.state) {
    case "Open":
      return role === "seller" ? "cancel" : "accept";
    case "Accepted": {
      if (role !== "seller") return role === "buyer" ? "wait" : "none";
      const deadline = Number(offer.pay_deadline);
      return deadline > 0 && nowSeconds >= deadline ? "reclaim" : "confirm";
    }
    default:
      return "none";
  }
}

/** Short button label for an action. */
export function actionLabel(action: P2pAction): string {
  switch (action) {
    case "accept":
      return "Accept";
    case "confirm":
      return "Confirm payment received";
    case "cancel":
      return "Cancel";
    case "reclaim":
      return "Reclaim";
    case "wait":
      return "Waiting for TRY";
    case "none":
      return "—";
  }
}

/** One-line explanation of the next step, safe to show a non-developer. */
export function actionHint(action: P2pAction, state: OfferState): string {
  switch (action) {
    case "accept":
      return "Take this offer, then pay TRY to the seller off-chain.";
    case "confirm":
      return "Confirm ONLY after the TRY arrived; this releases the tokens.";
    case "cancel":
      return "Cancel the open offer and unlock the tokens.";
    case "reclaim":
      return "The pay deadline passed; take the locked tokens back.";
    case "wait":
      return `Pay the TRY off-chain, then wait for the seller to confirm (${state}).`;
    case "none":
      return `No action available (${state}).`;
  }
}

/** Resolves an address to its alias, else `shortAddress`. */
export function labelFor(address: string | null, aliases: Record<string, string> = {}): string {
  if (!address) return "—";
  for (const [alias, value] of Object.entries(aliases)) {
    if (value === address) return alias;
  }
  return shortAddress(address);
}

/** Builds the display row for one offer. */
export function offerView(offer: Offer, owner: string | null, nowSeconds: number): OfferView {
  return {
    id: offer.id,
    state: offer.state,
    seller: offer.seller,
    sellerLabel: shortAddress(offer.seller),
    buyer: offer.buyer,
    amount: formatTokenAmount(offer.amount),
    priceTry: formatTry(offer.price_try_kurus),
    rate: formatRate(offer.amount, offer.price_try_kurus),
    expiresAt: Number(offer.expires_at),
    expiresIn: formatExpiresIn(Number(offer.expires_at), nowSeconds),
    role: roleOf(offer, owner),
    next: nextAction(offer, owner, nowSeconds),
  };
}
