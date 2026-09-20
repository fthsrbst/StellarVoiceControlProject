/**
 * `get_balance` — a read-only balance question (T1).
 *
 * "What's my balance" / "bakiyem ne kadar" is not a value-moving intent, so the
 * tool runs during the turn and needs no approval. The agent core never talks
 * to Horizon itself: the shell injects `ToolContext.readBalances` (built from
 * `stellar_config`). This module owns only the deterministic sentence — the
 * loop speaks it through `toSpeech`, so no second model turn is made and no raw
 * tool JSON is ever read aloud.
 */
import { languageBase } from "../language.ts";
import type { AgentTool, ToolContext } from "./registry.ts";

/** One asset line, as the shell read it from Horizon. */
export interface AssetBalance {
  code: string;
  /** Decimal string, exactly as Horizon returned it (e.g. "9989.0000000"). */
  amount: string;
}

/** Reads the connected wallet's balances; injected by the shell. */
export type BalanceReader = () => Promise<readonly AssetBalance[]>;

/** Raw model input: only the reply language is used. */
export interface GetBalanceInput {
  language?: unknown;
}

/** What `run` returns; `spoken` is the exact sentence the loop will say. */
export interface BalanceResult {
  balances: AssetBalance[];
  spoken: string;
}

const NATIVE = "XLM";

/** Horizon returns fixed 7-decimal strings; trims the noise for speech. */
export function trimAmount(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "0";
  const [whole = "0", frac = ""] = trimmed.split(".");
  const intPart = whole.replace(/^\+/, "") || "0";
  const fracPart = frac.replace(/0+$/, "");
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

function groupThousands(intPart: string, separator: string): string {
  const sign = intPart.startsWith("-") ? "-" : "";
  const digits = sign ? intPart.slice(1) : intPart;
  return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator)}`;
}

/** A deterministic, locale-aware amount string, e.g. `9,989.5` (en) / `9.989,5` (tr). */
export function formatBalanceAmount(raw: string, language?: string): string {
  const turkish = languageBase(language) === "tr";
  const [whole = "0", frac] = trimAmount(raw).split(".");
  const grouped = groupThousands(whole, turkish ? "." : ",");
  return frac ? `${grouped}${turkish ? "," : "."}${frac}` : grouped;
}

function hasFunds(raw: string): boolean {
  const value = Number(trimAmount(raw));
  return Number.isFinite(value) && value > 0;
}

/** The native asset first, then codes alphabetically, so the sentence is stable. */
function byNativeFirst(a: AssetBalance, b: AssetBalance): number {
  if (a.code === NATIVE) return b.code === NATIVE ? 0 : -1;
  if (b.code === NATIVE) return 1;
  return a.code.localeCompare(b.code);
}

function joinCodes(parts: readonly string[], language?: string): string {
  const first = parts[0] ?? "";
  if (parts.length <= 1) return first;
  const rest = parts.slice(1).join(", ");
  return languageBase(language) === "tr"
    ? `${first}, ${rest}`
    : `${first} and ${rest}`;
}

/** The short spoken sentence for the non-zero balances, or a "none" line. */
export function balanceSentence(balances: readonly AssetBalance[], language?: string): string {
  const held = balances
    .filter((balance) => hasFunds(balance.amount))
    .map((balance) => ({ ...balance, code: balance.code.toUpperCase() }))
    .sort(byNativeFirst);
  if (held.length === 0) {
    return languageBase(language) === "tr"
      ? "Bakiyende gösterecek bir varlık yok."
      : "You have no balance to show.";
  }
  const parts = held.map((balance) => `${formatBalanceAmount(balance.amount, language)} ${balance.code}`);
  const list = joinCodes(parts, language);
  return languageBase(language) === "tr" ? `${list} bakiyen var.` : `You have ${list}.`;
}

/** Said when the shell supplied no reader, or Horizon could not be reached. */
function unavailableSentence(language?: string): string {
  return languageBase(language) === "tr"
    ? "Bakiyeni şu an okuyamıyorum."
    : "I can't read your balance right now.";
}

function spokenLanguage(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export const getBalanceTool: AgentTool<GetBalanceInput, BalanceResult> = {
  name: "get_balance",
  description:
    "Get the connected wallet's balances from Stellar. Read-only; it never moves value.",
  inputSchema: {
    type: "object",
    properties: {
      language: {
        type: "string",
        description:
          'The language the user spoke, as a BCP-47 base code ("tr" or "en"). ' +
          "Used to phrase the spoken answer; never spoken itself.",
      },
    },
    additionalProperties: false,
  },
  async run(input: GetBalanceInput, ctx: ToolContext): Promise<BalanceResult> {
    const language = spokenLanguage(input?.language);
    if (!ctx.readBalances) {
      return { balances: [], spoken: unavailableSentence(language) };
    }
    try {
      const balances = [...(await ctx.readBalances())];
      return { balances, spoken: balanceSentence(balances, language) };
    } catch {
      // A read failure is reported as a short sentence, never as a raw error or
      // an invented number; a balance question must not crash the turn.
      return { balances: [], spoken: unavailableSentence(language) };
    }
  },
  toSpeech(output: BalanceResult): string {
    return output.spoken;
  },
};
