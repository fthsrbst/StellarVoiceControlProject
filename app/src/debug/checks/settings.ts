/**
 * Settings / environment diagnostics (T1).
 *
 * The non-destructive check behind the Settings panel: do its two config
 * sources answer, and is the configuration usable? It reads `voice_health`
 * (selected backends + key presence) and `stellar_config` (network, owner). It
 * never reads a secret value and never moves anything. A missing command or
 * config degrades to `warn`; a non-testnet network is the one hard `fail`.
 */
import { getVoiceHealth } from "@/debug/commands";
import { errorDetail, makeResult } from "@/debug/runner.ts";
import type { CheckResult, CheckStatus, FeatureCheck } from "@/debug/types.ts";
import { getStellarConfig } from "@/lib/stellarConfig";

const RANK: Record<CheckStatus, number> = { ok: 0, unknown: 0, warn: 1, fail: 2 };

function worst(current: CheckStatus, next: CheckStatus): CheckStatus {
  return RANK[next] > RANK[current] ? next : current;
}

export default {
  id: "settings",
  title: "Settings / environment",
  milestone: "W1",
  async run(): Promise<CheckResult> {
    let status: CheckStatus = "ok";
    const notes: string[] = [];

    let voice: Awaited<ReturnType<typeof getVoiceHealth>> | null = null;
    try {
      voice = await getVoiceHealth();
    } catch (error) {
      status = worst(status, "warn");
      notes.push(`voice_health is unavailable (${errorDetail(error)})`);
    }

    let chain: Awaited<ReturnType<typeof getStellarConfig>> | null = null;
    try {
      chain = await getStellarConfig();
    } catch (error) {
      status = worst(status, "warn");
      notes.push(`stellar_config is unavailable (${errorDetail(error)})`);
    }

    if (chain) {
      if (chain.network !== "testnet") {
        status = "fail";
        notes.push(`network is ${chain.network}, but this build is testnet-only`);
      } else if (!chain.ownerAddress) {
        status = worst(status, "warn");
        notes.push("POLARIS_OWNER_ADDRESS is not set in .env");
      }
    }

    if (voice) {
      const missing: string[] = [];
      if (voice.sttBackend === "groq" && !voice.groqKey) missing.push("GROQ_API_KEY");
      if (voice.agentProvider === "anthropic" ? !voice.anthropicKey : !voice.openaiCompatKey) {
        missing.push(voice.agentProvider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENCODE_API_KEY");
      }
      if (missing.length > 0) {
        status = worst(status, "warn");
        notes.push(`${missing.join(", ")} missing in .env`);
      }
    }

    if (notes.length === 0 && voice && chain) {
      notes.push(
        `testnet, owner set, backends ${voice.sttBackend}/${voice.ttsBackend}, provider ${voice.agentProvider}`,
      );
    }
    return makeResult(status, notes.join("; "));
  },
} satisfies FeatureCheck;
