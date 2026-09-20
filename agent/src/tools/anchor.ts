/**
 * `deposit` and `withdraw` — the anchor on/off-ramp intents (W5b).
 *
 * Like `send_payment`, neither tool is executable here: they validate the
 * model's arguments into the shared `Intent` and stop. The chain half
 * (`depositTry` / `withdrawTry` in `@polaris/stellar`) is driven by the
 * composition root (`app/src/lib/chain.ts`).
 *
 * Amounts are local-language amounts for a deposit ("50 lira yatır" -> 50 TRY)
 * and on-chain asset amounts for a withdrawal ("withdraw 5 USDC to TRY" -> 5
 * USDC). The fiat vocabulary lives here, next to the deposit tool, because
 * `assets.ts` describes the on-chain assets the payment path can move and a
 * deposit amount is the *other* currency.
 */
import type { Intent } from "@polaris/interfaces";
import { describeSupportedAssets, normalizeAsset } from "../assets.ts";
import { AgentError } from "../errors.ts";
import type { AgentTool, ToolContext } from "./registry.ts";
import { parseAmount } from "./payment.ts";

/** Words that mean the Turkish lira, lower-cased for matching. */
export const FIAT_CODE = "TRY";

/**
 * Canonicalises the local-currency asset of a deposit. A blank value is the
 * user's omission and defaults to TRY; anything outside the lira vocabulary is
 * rejected so a guess becomes a clarification.
 */
export function normalizeFiat(value: unknown): string | undefined {
  if (value === undefined || value === null) return FIAT_CODE;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return FIAT_CODE;
  switch (trimmed.toLowerCase()) {
    case "try":
    case "lira":
    case "liras":
    case "tl":
    case "₺":
      return FIAT_CODE;
    default:
      return undefined;
  }
}

function bad(tool: string, message: string): never {
  throw new AgentError("input", `${tool} arguments rejected: ${message}`);
}

/** Raw model output for a deposit. */
export interface DepositInput {
  amount?: unknown;
  asset?: unknown;
}

/**
 * Validates a model-supplied deposit and returns the shared `Intent`. `asset`
 * is the fiat the user is paying in; it canonicalises to `TRY` and any other
 * code is refused.
 */
export function parseDeposit(input: unknown, ctx: ToolContext): Intent {
  if (typeof input !== "object" || input === null) {
    bad("deposit", "arguments were not an object");
  }
  const raw = input as DepositInput;
  const amount = parseAmount(raw.amount);
  const asset = normalizeFiat(raw.asset);
  if (asset === undefined) {
    bad("deposit", `asset "${String(raw.asset)}" is not a supported local currency; only ${FIAT_CODE} is`);
  }
  return { kind: "deposit", asset, amount, source: ctx.transcript };
}

/** Raw model output for a withdrawal. */
export interface WithdrawInput {
  amount?: unknown;
  asset?: unknown;
}

/**
 * Validates a model-supplied withdrawal and returns the shared `Intent`. The
 * amount is the on-chain asset amount to cash out, so `asset` is canonicalised
 * against `assets.ts` exactly like a payment.
 */
export function parseWithdraw(input: unknown, ctx: ToolContext): Intent {
  if (typeof input !== "object" || input === null) {
    bad("withdraw", "arguments were not an object");
  }
  const raw = input as WithdrawInput;
  const amount = parseAmount(raw.amount);
  const asset = normalizeAsset(raw.asset);
  if (asset === undefined) {
    bad(
      "withdraw",
      `asset "${String(raw.asset)}" is not supported; supported assets are: ${describeSupportedAssets()}`,
    );
  }
  return { kind: "withdraw", asset, amount, source: ctx.transcript };
}

export const depositTool: AgentTool<DepositInput, Intent> = {
  name: "deposit",
  description:
    "Deposit local currency (TRY) through an anchor to receive the stablecoin USDC. The amount is the local-currency amount.",
  inputSchema: {
    type: "object",
    properties: {
      amount: {
        type: "string",
        description: 'Positive decimal amount in the local currency, e.g. "50".',
      },
      asset: {
        type: "string",
        description: `Local currency to pay in; only ${FIAT_CODE} is supported. Defaults to ${FIAT_CODE}.`,
      },
      language: {
        type: "string",
        description:
          'The language the user spoke, as a BCP-47 base code ("tr" or "en"). ' +
          "Used to pick the reply voice; never spoken.",
      },
    },
    required: ["amount"],
    additionalProperties: false,
  },
  requiresApproval: true,
  toIntent: parseDeposit,
  async run(input: DepositInput, ctx: ToolContext): Promise<Intent> {
    return parseDeposit(input, ctx);
  },
};

export const withdrawTool: AgentTool<WithdrawInput, Intent> = {
  name: "withdraw",
  description:
    "Cash out a Stellar asset (USDC) through an anchor to the user's bank in local currency (TRY). The amount is the on-chain asset amount.",
  inputSchema: {
    type: "object",
    properties: {
      amount: {
        type: "string",
        description: 'Positive decimal amount of the on-chain asset to cash out, e.g. "5".',
      },
      asset: {
        type: "string",
        description: `Asset code to cash out; only ${describeSupportedAssets()} are supported. Defaults to USDC.`,
      },
      language: {
        type: "string",
        description:
          'The language the user spoke, as a BCP-47 base code ("tr" or "en"). ' +
          "Used to pick the reply voice; never spoken.",
      },
    },
    required: ["amount"],
    additionalProperties: false,
  },
  requiresApproval: true,
  toIntent: parseWithdraw,
  async run(input: WithdrawInput, ctx: ToolContext): Promise<Intent> {
    return parseWithdraw(input, ctx);
  },
};
