import assert from "node:assert/strict";
import { test } from "node:test";

import { POLARIS_SYSTEM_PROMPT } from "./prompt.ts";

test("an unintelligible transcript gets one short sentence, not advice", () => {
  // The rule the F3-fix adds: junk must not become a lecture. It now lives in
  // capabilities.ts, so assert against the composed prompt the agent exports.
  assert.match(POLARIS_SYSTEM_PROMPT, /unintelligible/);
  assert.match(POLARIS_SYSTEM_PROMPT, /exactly one very short sentence/);
  assert.match(POLARIS_SYSTEM_PROMPT, /Sorry, I didn't catch that\./);
  // The fallback keeps the user's language tag: English example plus Turkish.
  assert.match(POLARIS_SYSTEM_PROMPT, /\[en\] Sorry, I didn't catch that\./);
  assert.match(POLARIS_SYSTEM_PROMPT, /Anlayamadım/);
});

test("spoken answers are capped at the TTS limit", () => {
  assert.match(POLARIS_SYSTEM_PROMPT, /under 120 characters/);
});

test("the few-shot shows a non-request answering with no tool call", () => {
  assert.match(POLARIS_SYSTEM_PROMPT, /no tool call, reply/);
});
