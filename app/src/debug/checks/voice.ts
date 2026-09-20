import { getVoiceHealth, type VoiceHealth } from "@/debug/commands.ts";
import { errorDetail, makeResult } from "@/debug/runner.ts";
import type { CheckResult, CheckStatus, FeatureCheck } from "@/debug/types.ts";

/** Severity order used to collapse the three pipelines into one status. */
const RANK: Record<CheckStatus, number> = { ok: 0, unknown: 0, warn: 1, fail: 2 };

function worst(current: CheckStatus, next: CheckStatus): CheckStatus {
  return RANK[next] > RANK[current] ? next : current;
}

/**
 * Turns the non-secret `voice_health` facts into one result.
 *
 * Missing cloud credentials are `fail` where the pipeline needs them (STT,
 * agent) and `warn` where a working local fallback exists (Fish TTS). A
 * configured on-device recognizer is `warn` because its locale availability
 * cannot be verified from configuration alone.
 */
function summarize(health: VoiceHealth): CheckResult {
  let status: CheckStatus = "ok";
  const notes: string[] = [];

  if (health.sttBackend === "groq") {
    if (health.groqKey) {
      notes.push("STT: Groq (cloud), GROQ_API_KEY present");
    } else {
      notes.push("STT: Groq (cloud) but GROQ_API_KEY is missing in .env");
      status = worst(status, "fail");
    }
  } else {
    notes.push("STT: on-device (audio stays local); recognizer availability not verified");
    status = worst(status, "warn");
  }

  if (health.ttsBackend === "local") {
    notes.push("TTS: local macOS speech");
  } else if (health.fishKey) {
    notes.push("TTS: Fish Audio, FISH_AUDIO_API_KEY present");
  } else {
    notes.push("TTS: Fish Audio but FISH_AUDIO_API_KEY is missing — local macOS fallback");
    status = worst(status, "warn");
  }

  if (health.agentProvider === "openai") {
    if (health.openaiCompatKey) {
      notes.push("agent: openai-compatible, key present");
    } else {
      notes.push("agent: openai-compatible but OPENCODE_API_KEY is missing in .env");
      status = worst(status, "fail");
    }
  } else if (health.anthropicKey) {
    notes.push("agent: Anthropic, key present");
  } else {
    notes.push("agent: Anthropic but ANTHROPIC_API_KEY is missing in .env");
    status = worst(status, "fail");
  }

  return makeResult(status, notes.join("; "));
}

/** Which voice backends are configured and whether their keys are present. */
export default {
  id: "voice",
  title: "Voice pipeline config",
  milestone: "W0",
  async run() {
    try {
      return summarize(await getVoiceHealth());
    } catch (error) {
      return makeResult("fail", `voice_health failed: ${errorDetail(error)}`);
    }
  },
} satisfies FeatureCheck;
