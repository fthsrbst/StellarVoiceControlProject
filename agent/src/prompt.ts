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
  ...assetRules(),
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
