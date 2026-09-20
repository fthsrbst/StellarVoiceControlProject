/**
 * Decimal conversions for the P2P escrow price.
 *
 * The token side (USDC, 7 decimals) reuses `guard/amount.ts` so there is one
 * raw-unit rule for the whole chain lane. TRY has two decimals: the contract
 * stores the asking price as **kurus** (`price_try_kurus`, TRY * 100), while the
 * user speaks and reads lira. All conversions are exact bigint arithmetic — no
 * float ever touches a price.
 */
import { P2pRefusal } from "./errors.ts";

/** Kurus per Turkish lira. */
export const KURUS_PER_LIRA = 100n;

/** Positive decimal, at most 2 fraction digits, no sign/exponent/whitespace. */
const TRY_RE = /^\d{1,12}(\.\d{1,2})?$/;

/** Decimal TRY string -> integer kurus (`"3400"` -> `340000n`). */
export function tryToKurus(amount: string): bigint {
  if (typeof amount !== "string" || !TRY_RE.test(amount)) {
    throw new P2pRefusal(
      "invalid_price",
      `price must be a positive TRY decimal string with at most 2 fraction digits, got ${JSON.stringify(amount)}`,
    );
  }
  const [whole = "0", frac = ""] = amount.split(".") as [string, string?];
  const kurus = BigInt(whole) * KURUS_PER_LIRA + BigInt(frac.padEnd(2, "0") || "0");
  if (kurus <= 0n) {
    throw new P2pRefusal("invalid_price", `price must be greater than zero, got ${JSON.stringify(amount)}`);
  }
  return kurus;
}

/** Integer kurus -> decimal TRY string with trailing zeros trimmed (`340050n` -> `"3400.5"`). */
export function kurusToTry(kurus: bigint): string {
  if (typeof kurus !== "bigint") {
    throw new P2pRefusal("invalid_price", `kurus must be a bigint, got ${typeof kurus}`);
  }
  if (kurus < 0n) {
    throw new P2pRefusal("invalid_price", `kurus must not be negative, got ${kurus}`);
  }
  const whole = kurus / KURUS_PER_LIRA;
  const frac = (kurus % KURUS_PER_LIRA).toString().padStart(2, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}
