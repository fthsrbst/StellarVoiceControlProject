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
