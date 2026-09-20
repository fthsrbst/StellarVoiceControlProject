/**
 * Account-alias normalisation (step F2).
 *
 * A spoken command reaches the model exactly as the recogniser wrote it, so
 * "wallet 2", "hesap 2", "ikinci hesap" or a garbled "ek 2" / "AC2" / "a c c 2"
 * / "O 2" must all mean the same account before the model sees them. The owner
 * wallet (`acc1`) is the only sender; `acc2` is the demo recipient. Both
 * `normalizeAccountRefs` (a text rewrite applied before the model call and,
 * for named aliases, before intent validation) and `normalizeRecipient` (the
 * last-resort validation helper) are pure, so the normalisation is deterministic
 * and unit-testable without a provider.
 */
import type { AgentLlm, LlmTurn } from "./loop.ts";
import type { AgentTool } from "./tools/registry.ts";

/** The connected wallet: always the sender, never a recipient choice. */
export const OWNER_ALIAS = "acc1";

/** The demo recipient alias users say "wallet 2" / "hesap 2" for. */
export const RECIPIENT_ALIAS = "acc2";

/** Alias name (lowercase) -> `G...` address, as supplied by the config. */
export type AliasMap = Readonly<Record<string, string>>;

/** A short (never full) human label for one account, used in the prompt. */
export interface AccountRef {
  label: string;
  /** Truncated for the prompt; the full address is never spoken. */
  address?: string;
}

/** The account table injected into the system prompt. */
export type AccountBook = Readonly<Record<string, AccountRef>>;

/** Nouns people use for "account" before or after an ordinal, plus STT garbles. */
const NOUN =
  "(?:wallet|cüzdan|cuzdan|hesap(?:lar)?|hesab\\w*|account|acc|ac|ek|akkaunt)";

const ORDINAL_ONE = "(?:1|one|first|bir|birinci)";
const ORDINAL_TWO = "(?:2|two|second|iki|ikinci)";

/**
 * Ordered rewrite rules. Each match is replaced by the canonical alias; the
 * suffix the user spoke (`"'den"`, `"'ye"`) sits outside the match and survives.
 */
const RULES: ReadonlyArray<{ re: RegExp; to: string }> = [
  // "benim hesabım" / "my wallet" are the owner.
  { re: /\b(?:benim|my)\s+(?:hesab[ıi]m|hesap|cüzdan|cuzdan|wallet|account)\b/gi, to: OWNER_ALIAS },
  // Ordinal before the noun.
  { re: new RegExp(`\\b(?:first|birinci)\\s+${NOUN}\\b`, "gi"), to: OWNER_ALIAS },
  { re: new RegExp(`\\b(?:second|ikinci)\\s+${NOUN}\\b`, "gi"), to: RECIPIENT_ALIAS },
  // Noun before the ordinal ("wallet 2", "hesap 2", "ek 2", compact "acc2").
  { re: new RegExp(`\\b${NOUN}\\s*(?:number\\s*)?${ORDINAL_ONE}\\b`, "gi"), to: OWNER_ALIAS },
  { re: new RegExp(`\\b${NOUN}\\s*(?:number\\s*)?${ORDINAL_TWO}\\b`, "gi"), to: RECIPIENT_ALIAS },
  // "2 numaralı hesap", "iki numaralı hesap".
  {
    re: new RegExp(`\\b${ORDINAL_ONE}\\s*(?:numaral[ıi]|numarali)?\\s*(?:hesap|cüzdan|wallet|account)\\b`, "gi"),
    to: OWNER_ALIAS,
  },
  {
    re: new RegExp(`\\b${ORDINAL_TWO}\\s*(?:numaral[ıi]|numarali)?\\s*(?:hesap|cüzdan|wallet|account)\\b`, "gi"),
    to: RECIPIENT_ALIAS,
  },
  // Letter-spaced garbage the recogniser emits.
  { re: /\ba\s+c\s+c\s*1\b/gi, to: OWNER_ALIAS },
  { re: /\ba\s+c\s+c\s*2\b/gi, to: RECIPIENT_ALIAS },
  { re: /\bo\s*2\b/gi, to: RECIPIENT_ALIAS },
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Rewrites every account reference in `text` to its canonical alias
 * (`acc1`/`acc2`) and canonicalises the case of known configured aliases.
 *
 * Pure: it never needs the network or the model, so the same call can run
 * before the request and again for validation without drifting.
 */
export function normalizeAccountRefs(text: string, aliases: AliasMap = {}): string {
  if (typeof text !== "string" || text.length === 0) {
    return text;
  }
  let out = text;
  for (const { re, to } of RULES) {
    out = out.replace(re, to);
  }
  for (const name of Object.keys(aliases)) {
    if (name.length === 0) continue;
    out = out.replace(new RegExp(`\\b${escapeRegExp(name)}\\b`, "gi"), name);
  }
  return out;
}

/**
 * Resolves a model-supplied recipient to a known canonical alias, or
 * `undefined` when it is not a known account. Validation uses this so a raw
 * "wallet 2" the model returned is still accepted as `acc2`.
 */
export function normalizeRecipient(value: string, aliases: AliasMap = {}): string | undefined {
  const normalized = normalizeAccountRefs(value, aliases);
  const known = new Set<string>([
    OWNER_ALIAS,
    RECIPIENT_ALIAS,
    ...Object.keys(aliases).map((name) => name.toLowerCase()),
  ]);
  for (const token of normalized.toLowerCase().split(/[^a-z0-9]+/)) {
    if (known.has(token)) {
      return token;
    }
  }
  return undefined;
}

/** Truncates a `G...` address for display: `GABC…WXYZ`. */
export function shortAddress(address: string | null | undefined): string | undefined {
  const trimmed = address?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length <= 12 ? trimmed : `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

/**
 * Builds the prompt account table: the owner (`acc1`), the demo recipient
 * (`acc2`, synthesised when the config does not list it) and every configured
 * alias. Only a short address is kept; a missing address stays label-only.
 */
export function buildAccountBook(
  ownerAddress: string | null | undefined,
  aliases: AliasMap = {},
): AccountBook {
  const book: Record<string, AccountRef> = {};
  const ownerShort = shortAddress(ownerAddress);
  book[OWNER_ALIAS] = { label: OWNER_ALIAS, ...(ownerShort ? { address: ownerShort } : {}) };
  book[RECIPIENT_ALIAS] = { label: RECIPIENT_ALIAS };
  for (const [name, address] of Object.entries(aliases)) {
    const short = shortAddress(address);
    book[name] = { label: name, ...(short ? { address: short } : {}) };
  }
  return book;
}

/**
 * The `AgentLlm` decorator that normalises account references in the transcript
 * *before* the model sees it. The system prompt teaches the mapping; this makes
 * it deterministic, so even a model that echoes "wallet 2" receives `acc2`.
 */
export class AccountRefLlm implements AgentLlm {
  readonly #inner: AgentLlm;
  readonly #aliases: AliasMap;

  constructor(inner: AgentLlm, aliases: AliasMap = {}) {
    this.#inner = inner;
    this.#aliases = aliases;
  }

  get model(): string {
    return this.#inner.model;
  }

  turn(input: {
    transcript: string;
    system: string;
    tools: Array<Pick<AgentTool, "name" | "description" | "inputSchema">>;
  }): Promise<LlmTurn> {
    return this.#inner.turn({
      ...input,
      transcript: normalizeAccountRefs(input.transcript, this.#aliases),
    });
  }
}
