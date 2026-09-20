/**
 * In-file fixtures for the approval card's demo mode (`#/approval?demo=…`).
 *
 * The frontend owner needs to style the card without the Rust approval gate
 * (W3) or a real Touch ID prompt. Demo mode swaps the command set for this
 * fixture-backed one and shows a mandatory banner, so a demo can never be
 * mistaken for a real approval. Real mode never imports a fixture.
 */
import type { Intent } from "@polaris/interfaces";

import type {
  ApprovalCommands,
  ApprovalError,
  ApprovalSnapshot,
} from "../../lib/approval.ts";

/** Which fixture the window asked for. */
export type ApprovalDemoMode = "live" | "expired" | "error";

/** The mandatory overlay on every demo card. */
export const DEMO_BANNER = "DEMO — nothing is signed";

const DEMO_SUMMARY = {
  title: "Send 25 XLM to ada",
  lines: [
    "To GBZQ…7F2K (ada)",
    "Fee: 0.0000100 XLM",
    "Memo: invoice 42",
    "Operation: payment",
  ],
  explorerUrl: "https://stellar.expert/explorer/testnet/tx/unsigned",
  estimatedFee: "0.0000100 XLM",
};

const DEMO_INTENT: Intent = {
  kind: "send",
  asset: "XLM",
  amount: "25",
  recipient: "GBZQ…7F2K",
  alias: "ada",
  memo: "invoice 42",
  source: "send 25 lumens to ada",
};

/** Payload hash used by the fixture; real hashes are 64 hex chars. */
export const DEMO_PAYLOAD_HASH =
  "9f2c1b7a4e5d6038c1a2b3d4e5f60718293a4b5c6d7e8f9012345678abcdef01";

/** A live pending request, expiring two minutes after the bundle loads. */
export const DEMO_SNAPSHOT: ApprovalSnapshot = {
  id: "demo-0001",
  payloadHash: DEMO_PAYLOAD_HASH,
  summary: DEMO_SUMMARY,
  intent: DEMO_INTENT,
  mode: "touch_id",
  state: "pending",
  expiresAtMs: Date.now() + 120_000,
};

/** The same request, already past its deadline. */
export const DEMO_EXPIRED_SNAPSHOT: ApprovalSnapshot = {
  ...DEMO_SNAPSHOT,
  id: "demo-0002",
  expiresAtMs: Date.now() - 1_000,
};

/** The failure the `demo=error` command set rejects with. */
export const DEMO_ERROR: ApprovalError = {
  kind: "failed",
  message: "Touch ID failed in demo mode — nothing was signed",
};

/**
 * A command set that answers from the fixtures. `authorize` simulates a one
 * second Touch ID prompt so the `authorizing` state is visible; it signs
 * nothing. The `error` variant fails on hydrate so the error card can be styled.
 */
export function createDemoCommands(mode: ApprovalDemoMode): ApprovalCommands {
  if (mode === "error") {
    return {
      current: () => Promise.reject(DEMO_ERROR),
      authorize: () => Promise.reject(DEMO_ERROR),
      deny: () => Promise.reject(DEMO_ERROR),
    };
  }

  let snapshot: ApprovalSnapshot =
    mode === "expired" ? { ...DEMO_EXPIRED_SNAPSHOT } : { ...DEMO_SNAPSHOT };

  return {
    current: () => Promise.resolve({ ...snapshot }),
    authorize: async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      snapshot = { ...snapshot, state: "authorized" };
      return { ...snapshot };
    },
    deny: () => {
      snapshot = { ...snapshot, state: "denied" };
      return Promise.resolve({ ...snapshot });
    },
  };
}
