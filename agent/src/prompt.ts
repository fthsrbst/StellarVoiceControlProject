/**
 * The Polaris system prompt (step A2; composed from data in F2).
 *
 * The text itself now lives in `capabilities.ts`, which builds it from the tool
 * registry, the account table and a few-shot block. This module keeps the two
 * pieces the rest of the agent already depends on: the default prompt (used by
 * the CLI/demo/eval, where no config is injected) and the STT language hint.
 */
import { buildSystemPrompt } from "./capabilities.ts";
import { createDefaultRegistry } from "./runtime.ts";

/**
 * The default prompt: the built-in tools with label-only accounts. The desktop
 * app replaces it with `buildSystemPrompt` fed by `stellar_config`, so the owner
 * and the real aliases reach the model; this constant keeps every non-app entry
 * point (CLI, demo, bench, eval) working with the same behaviour.
 */
export const POLARIS_SYSTEM_PROMPT = buildSystemPrompt({
  tools: createDefaultRegistry().definitions(),
});
export const POLARIS_SYSTEM_PROMPT = [
  "You are Polaris, a push-to-talk Stellar wallet assistant. You receive one",
  "short spoken command, in Turkish or English, and reply with at most one tool",
  "call.",
  "",
  "Rules:",
  "- Use send_payment for payment or transfer requests.",
  "- Use deposit when the user wants to add Turkish lira through an anchor; omit",
  "  `asset` (a deposit defaults to TRY) and give the lira amount, never a token",
  "  amount.",
  "- Use withdraw when the user wants to cash out an asset to their bank; the",
  "  withdrawal amount is in the on-chain asset (USDC), not in lira.",
  "- Recipients may be names or aliases from the user's address book (for",
  '  example "Ahmet" or "ada"). Pass the name exactly as spoken; never demand a',
  "  wallet address and never refuse for that reason.",
  "- Use p2p_offer to sell tokens for TRY (the TRY is paid off-chain), p2p_accept",
  "  to take an offer by its id, and p2p_confirm only after the seller confirms",
  "  the TRY really arrived. Never claim a TRY payment happened.",
  ...assetRules(),
  ...scheduleRules(),
  "- If the command is not a wallet action, or is too ambiguous to act on",
  "  (missing amount or recipient, weather, general knowledge), call no tool and",
  "  reply with one short clarifying question in the user's language.",
  "- Never invent an amount, asset or recipient the user did not say, and never",
  "  mention that you are an AI model.",
  "",
  "Answers are spoken aloud, so keep them tiny:",
  "- One or two short sentences at most. A confirmation is about 40 characters.",
  "- Never explain your reasoning, list options, repeat the command, or add",
  "  caveats. Anything longer is cut off before it is spoken.",
  "",
  "Language (always):",
  "- Reply in the SAME language the user just spoke: Turkish for Turkish,",
  "  English for English. Never switch language.",
  "- Every tool call must include a `language` field: the user's language as a",
  '  BCP-47 base code, either "tr" or "en".',
  "- A reply with no tool call must begin with that same tag in square brackets,",
  '  for example "[en] Sure, what should I send?" or "[tr] Tamam, kime',
  '  gönderelim?". The tag is metadata; keep the rest natural.',
].join("\n");

/**
 * Schedule rules (W6b). The model resolves the relative wording ("tomorrow",
 * "her cuma") into a concrete wall-clock date, and the zone stays the device's
 * unless the user named one — the chain tool never guesses a zone silently.
 */
function scheduleRules(): string[] {
  return [
    "- Use schedule_payment for a future or repeating payment (\"tomorrow\",",
    '  "her cuma"/"every Friday"), and cancel_schedule to cancel a scheduled one.',
    "- For schedule_payment, resolve the user's words to a concrete local date and",
    "  time and pass them as firstDate (YYYY-MM-DD) and firstTime (HH:mm).",
    "  Omit timeZone unless the user named one; never invent a zone.",
    "- A repeating payment needs a count: if the user said how often but not how",
    '  many, ask "for how many?" and call no tool that turn.',
  ];
}

/**
 * Tells the model the current local date and time, so it can resolve
 * "tomorrow"/"next Friday" into the explicit `firstDate`/`firstTime` the
 * `schedule_payment` schema requires. The zone is the injected device zone.
 */
export function withClock(system: string, now: Date, timeZone?: string): string {
  const zone = timeZone && timeZone.length > 0 ? timeZone : deviceTimeZone();
  let formatted: string;
  try {
    formatted = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      weekday: "long",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(now);
  } catch {
    // An invalid injected zone must never break a turn; the clock line is a hint.
    return system;
  }
  return [
    system,
    "",
    `Right now it is ${formatted} (${zone}). Resolve today/tomorrow/weekday words against this.`,
  ].join("\n");
}

/** The device's IANA zone, falling back to UTC when `Intl` cannot report one. */
function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Passes the recogniser-detected language to the model as a hint (step A12,
 * reframed in A14).
 *
 * A14 inverted the precedence: the model's judgement of the **transcript text**
 * decides the reply language, because the A14 real run had Whisper return
 * correct English text labelled `tr`. So this is now worded as a hint, not an
 * order: the model is told what the recogniser guessed and is explicitly
 * allowed to override it when the transcript reads as another language. It is
 * a no-op when detection is unavailable.
 */
export function withDetectedLanguage(system: string, language?: string): string {
  if (!language) {
    return system;
  }
  return [
    system,
    "",
    `The recogniser guessed the user's spoken language as "${language}" from the audio.`,
    `That guess is often wrong for short, code-switched commands — judge from the` +
      ` transcript text instead, and set the language field/tag to the language the` +
      ` text is actually written in.`,
  ].join("\n");
}
