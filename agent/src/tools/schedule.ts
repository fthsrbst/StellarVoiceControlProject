/**
 * `schedule_payment` and `cancel_schedule` — the voice half of scheduled
 * payments (W6b).
 *
 * Both are **approval-gated and never executable during the turn**, exactly like
 * `send_payment`: the tool validates whatever the model produced into the shared
 * `Intent` (`docs/interfaces.md` §1), which the shell later routes through the
 * chain tool and the Touch ID gate.
 *
 * ## Who resolves the natural language
 *
 * The model turns "her cuma 10:00'da acc2'ye 5 XLM gönder" into concrete
 * `firstDate`/`firstTime`/`repeat` fields; this module only validates them and
 * fills the **explicit IANA zone**. The zone comes from the tool context (the
 * Mac's device zone, injected by the shell) unless the utterance named one — it
 * is never assumed silently inside the chain tool. Relative parsing is therefore
 * model work; the small word maps below (`normalizeRepeat`, `normalizeWhich`)
 * exist so a colloquial `"her cuma"` / `"every Friday"` still canonicalises
 * instead of reaching the chain as an unknown repeat.
 *
 * A `repeat` with no `runs` is rejected as bad input: the design (§11b) says the
 * agent must **ask "for how many?"**, never invent an open-ended repeat. A
 * one-shot (`repeat` absent) needs no count.
 */
import type { Intent } from "@polaris/interfaces";
import { normalizeAsset, describeSupportedAssets } from "../assets.ts";
import { AgentError } from "../errors.ts";
import type { AgentTool, ToolContext } from "./registry.ts";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
/** The decimal-string money rule from `docs/interfaces.md` §1. */
const AMOUNT_RE = /^\d+(?:\.\d+)?$/;

function bad(tool: string, message: string): never {
  throw new AgentError("input", `${tool} arguments rejected: ${message}`);
}

/** A positive decimal amount as a non-empty string; rejects anything else. */
function parseAmount(tool: string, value: unknown): string {
  const candidate = typeof value === "number" ? (Number.isFinite(value) ? String(value) : undefined) : value;
  if (typeof candidate !== "string") bad(tool, "amount must be a string or a number");
  const amount = candidate.trim();
  if (!AMOUNT_RE.test(amount)) bad(tool, `amount is not a positive decimal: "${amount}"`);
  if (!/[1-9]/.test(amount)) bad(tool, `amount must be greater than zero: "${amount}"`);
  return amount;
}

function requireText(tool: string, value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    bad(tool, `${field} must be a non-empty string`);
  }
  return value.trim();
}

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** True when `Intl` accepts the zone name. Pure; never throws. */
export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const NONE_WORDS = ["", "none", "no", "one-shot", "oneshot", "tek seferlik", "bir kez"];
const DAY_WORDS = ["day", "daily", "every day", "her gun", "her gün", "günlük", "gunluk", "günde"];
const WEEK_WORDS = [
  "week",
  "weekly",
  "every week",
  "her hafta",
  "haftalık",
  "haftalik",
  "her cuma",
  "her pazartesi",
  "her salı",
  "her sali",
  "her çarşamba",
  "her carsamba",
  "her perşembe",
  "her persembe",
  "her cumartesi",
  "her pazar",
  "every friday",
  "every monday",
];

/** The canonical repeat words; `"none"` is a one-shot and is omitted from the Intent. */
export type RepeatWord = "day" | "week" | "custom" | "none";

/**
 * Canonicalises a repeat word to a `RepeatWord`. An absent/blank field is
 * `"none"` (one-shot); a recognisable Turkish or English cadence maps to
 * `"day"`/`"week"`; anything else is `undefined` so the caller can reject it
 * rather than silently treating a phrase it did not understand as one-shot.
 */
export function normalizeRepeat(value: unknown): RepeatWord | undefined {
  if (value === undefined || value === null) return "none";
  if (typeof value !== "string") return undefined;
  const word = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (NONE_WORDS.includes(word)) return "none";
  if (word === "custom") return "custom";
  if (DAY_WORDS.includes(word)) return "day";
  if (WEEK_WORDS.includes(word)) return "week";
  return undefined;
}

/** Canonicalises "next"/"last", accepting the Turkish words. */
export function normalizeWhich(value: unknown): "last" | "next" | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return undefined;
  const word = value.trim().toLowerCase();
  if (word === "last" || word === "son" || word === "sonuncu") return "last";
  if (word === "next" || word === "ilk" || word === "bir sonraki" || word === "gelecek") return "next";
  return undefined;
}

/** Raw model output for a scheduled payment. */
export interface SchedulePaymentInput {
  amount?: unknown;
  asset?: unknown;
  recipient?: unknown;
  firstDate?: unknown;
  firstTime?: unknown;
  timeZone?: unknown;
  repeat?: unknown;
  intervalSeconds?: unknown;
  runs?: unknown;
  language?: unknown;
}

/** Raw model output for a schedule cancellation. */
export interface CancelScheduleInput {
  recipient?: unknown;
  scheduleId?: unknown;
  which?: unknown;
  language?: unknown;
}

/** Validates a model-supplied scheduled payment into a `schedule_payment` Intent. */
export function parseSchedulePayment(input: unknown, ctx: ToolContext): Intent {
  const tool = "schedule_payment";
  if (typeof input !== "object" || input === null) bad(tool, "arguments were not an object");
  const raw = input as SchedulePaymentInput;

  const amount = parseAmount(tool, raw.amount);
  const asset = normalizeAsset(raw.asset);
  if (asset === undefined) {
    bad(tool, `asset "${String(raw.asset)}" is not supported; supported assets are: ${describeSupportedAssets()}`);
  }
  const recipient = requireText(tool, raw.recipient, "recipient");

  const firstDate = requireText(tool, raw.firstDate, "firstDate");
  if (!DATE_RE.test(firstDate)) bad(tool, `firstDate must be "YYYY-MM-DD", got "${firstDate}"`);
  const firstTime = requireText(tool, raw.firstTime, "firstTime");
  if (!TIME_RE.test(firstTime)) bad(tool, `firstTime must be "HH:mm", got "${firstTime}"`);

  // Explicit zone: a model-supplied valid zone wins; otherwise the device zone.
  let timeZone = ctx.timeZone ?? deviceTimeZone();
  const requestedZone = typeof raw.timeZone === "string" ? raw.timeZone.trim() : "";
  if (requestedZone.length > 0) {
    if (!isValidTimeZone(requestedZone)) bad(tool, `timeZone "${requestedZone}" is not a valid IANA zone`);
    timeZone = requestedZone;
  }

  const repeatWord = raw.repeat === undefined || raw.repeat === null ? "none" : raw.repeat;
  const repeat = normalizeRepeat(repeatWord);
  if (repeat === undefined) {
    bad(tool, `repeat "${String(raw.repeat)}" is not supported; use day, week, custom or none`);
  }

  const intent: Intent = {
    kind: "schedule_payment",
    asset,
    amount,
    recipient,
    firstRun: { localDate: firstDate, localTime: firstTime, timeZone },
    source: ctx.transcript,
  };

  if (repeat === "none") {
    if (raw.runs !== undefined && raw.runs !== null && raw.runs !== 1) {
      bad(tool, "a one-shot schedule has runs = 1; pass a repeat to run it more than once");
    }
    return intent;
  }

  if (typeof raw.runs !== "number" || !Number.isInteger(raw.runs) || raw.runs < 1) {
    bad(tool, "runs is required for a repeating schedule; ask the user how many times");
  }
  if (repeat === "custom") {
    const customSeconds = raw.intervalSeconds;
    if (typeof customSeconds !== "number" || !Number.isSafeInteger(customSeconds) || customSeconds < 1) {
      bad(tool, "intervalSeconds must be a positive integer number of seconds for a custom repeat");
    }
    intent.repeat = { every: "custom", customSeconds };
  } else {
    intent.repeat = { every: repeat };
  }
  intent.runs = raw.runs;
  return intent;
}

/** Validates a model-supplied cancellation into a `cancel_schedule` Intent. */
export function parseCancelSchedule(input: unknown, ctx: ToolContext): Intent {
  const tool = "cancel_schedule";
  if (typeof input !== "object" || input === null) bad(tool, "arguments were not an object");
  const raw = input as CancelScheduleInput;

  const intent: Intent = { kind: "cancel_schedule", asset: "", amount: "", source: ctx.transcript };

  if (raw.scheduleId !== undefined && raw.scheduleId !== null) {
    if (typeof raw.scheduleId !== "number" || !Number.isInteger(raw.scheduleId) || raw.scheduleId < 0) {
      bad(tool, `scheduleId must be a non-negative integer, got ${JSON.stringify(raw.scheduleId)}`);
    }
    intent.scheduleId = raw.scheduleId;
  }
  if (raw.recipient !== undefined && raw.recipient !== null) {
    intent.recipient = requireText(tool, raw.recipient, "recipient");
  }
  if (intent.scheduleId === undefined && intent.recipient === undefined) {
    bad(tool, "needs a recipient alias or an explicit scheduleId");
  }
  if (raw.which !== undefined && raw.which !== null) {
    if (intent.recipient === undefined) bad(tool, '"which" only applies when cancelling by recipient');
    const which = normalizeWhich(raw.which);
    if (!which) bad(tool, `which must be "next" or "last", got ${JSON.stringify(raw.which)}`);
    intent.which = which;
  }
  return intent;
}

export const schedulePaymentTool: AgentTool<SchedulePaymentInput, Intent> = {
  name: "schedule_payment",
  description:
    "Schedule a future or repeating Stellar payment. The recipient may be an address-book name. " +
    "Times are the user's local wall clock; pass the explicit IANA timeZone when the user named one.",
  inputSchema: {
    type: "object",
    properties: {
      amount: { type: "string", description: 'Positive decimal amount as a string, e.g. "5".' },
      asset: {
        type: "string",
        description: `Asset code; only ${describeSupportedAssets()} are supported. Defaults to USDC.`,
      },
      recipient: {
        type: "string",
        description: 'Recipient name or alias from the address book, exactly as spoken, e.g. "acc2".',
      },
      firstDate: {
        type: "string",
        description: 'First run date the user means, in their local calendar, as "YYYY-MM-DD".',
      },
      firstTime: {
        type: "string",
        description: 'First run time the user means, in their local clock, as "HH:mm" (24-hour).',
      },
      timeZone: {
        type: "string",
        description:
          "IANA zone only when the user named one; omit it to use the device's zone (default).",
      },
      repeat: {
        type: "string",
        description: 'One of "none" (one-shot, default), "day", "week" or "custom".',
      },
      intervalSeconds: {
        type: "number",
        description: "Positive integer seconds; required only when repeat is \"custom\".",
      },
      runs: {
        type: "number",
        description:
          "How many times to run. Required for any repeat; ask the user if they did not say. Not used for one-shot.",
      },
      language: {
        type: "string",
        description:
          'The language the user spoke, as a BCP-47 base code ("tr" or "en"). Never spoken.',
      },
    },
    required: ["amount", "asset", "recipient", "firstDate", "firstTime"],
    additionalProperties: false,
  },
  requiresApproval: true,
  toIntent: parseSchedulePayment,
  async run(input: SchedulePaymentInput, ctx: ToolContext): Promise<Intent> {
    return parseSchedulePayment(input, ctx);
  },
};

export const cancelScheduleTool: AgentTool<CancelScheduleInput, Intent> = {
  name: "cancel_schedule",
  description:
    "Cancel one of the user's scheduled payments. Use the recipient alias; if more than one " +
    "schedule pays that person, ask which one instead of guessing.",
  inputSchema: {
    type: "object",
    properties: {
      recipient: {
        type: "string",
        description: 'Recipient name or alias whose schedule should be cancelled, e.g. "acc2".',
      },
      scheduleId: {
        type: "number",
        description: "Exact schedule id, only when the user named one.",
      },
      which: {
        type: "string",
        description: 'With a recipient: "next" (soonest) or "last" (latest) when several match.',
      },
      language: {
        type: "string",
        description:
          'The language the user spoke, as a BCP-47 base code ("tr" or "en"). Never spoken.',
      },
    },
    required: [],
    additionalProperties: false,
  },
  requiresApproval: true,
  toIntent: parseCancelSchedule,
  async run(input: CancelScheduleInput, ctx: ToolContext): Promise<Intent> {
    return parseCancelSchedule(input, ctx);
  },
};
