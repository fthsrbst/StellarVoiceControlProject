/**
 * Tauri commands used only by the Debug panel and its checks (step W0b).
 *
 * `@/lib/polaris` owns the shared seam commands (`app_info`, `capture_status`, …);
 * the commands here are debug-only and would clutter it. They are still
 * centralised so no check calls `invoke` directly.
 */
import { invoke } from "@tauri-apps/api/core";

/** The `voice_health` payload (mirrors `VoiceHealth` in Rust). */
export interface VoiceHealth {
  sttBackend: "groq" | "ondevice";
  ttsBackend: "fish" | "local";
  agentProvider: "openai" | "anthropic";
  groqKey: boolean;
  fishKey: boolean;
  anthropicKey: boolean;
  openaiCompatKey: boolean;
}

/** The owner config the Debug header shows when the command is present. */
export interface StellarConfig {
  ownerAddress?: string;
  network?: string;
  horizonUrl?: string;
  networkPassphrase?: string;
  aliases?: Record<string, string>;
}

/** The Rust `FeatureHealth` shape, shared by `biometric_health`/`bridge_health`. */
export interface DebugFeatureHealth {
  id: string;
  title: string;
  milestone: string;
  status: "ok" | "warn" | "fail" | "unknown";
  detail: string;
  checkedAt: number;
}

/** The Rust `BridgeOutcome` union (serde camelCase). */
export type DebugBridgeOutcome =
  | { ok: true; signedXdr: string; signerAddress: string; txHash: string }
  | {
      ok: false;
      code:
        | "rejected"
        | "address_mismatch"
        | "network_mismatch"
        | "wallet_unavailable"
        | "not_authorized"
        | "integrity"
        | "timeout"
        | "error";
      message: string;
    };

/** Non-secret voice-pipeline config facts. */
export async function getVoiceHealth(): Promise<VoiceHealth> {
  return invoke<VoiceHealth>("voice_health");
}

/**
 * Reads `stellar_config` when that command exists on this branch. It is owned by
 * another milestone, so the Debug header feature-detects it: a missing command is
 * `null`, not an error.
 */
export async function getStellarConfigIfAvailable(): Promise<StellarConfig | null> {
  try {
    return await invoke<StellarConfig>("stellar_config");
  } catch {
    return null;
  }
}

/**
 * Non-prompting Touch ID probe (`biometric_health`). Feature-detected: it is
 * owned by W3, so a branch without it resolves `null` rather than failing.
 */
export async function getBiometricHealthIfAvailable(): Promise<DebugFeatureHealth | null> {
  try {
    return await invoke<DebugFeatureHealth>("biometric_health");
  } catch {
    return null;
  }
}

/**
 * The real Touch ID prompt (`biometric_selftest`). A side-effecting self-test;
 * only ever called from an explicit Debug-panel action, never from a check.
 */
export async function biometricSelftest(): Promise<DebugFeatureHealth> {
  return invoke<DebugFeatureHealth>("biometric_selftest");
}

/**
 * Bridge readiness (`bridge_health`): can a loopback listener bind, are the
 * bridge assets servable, is the owner configured, which browser is used.
 */
export async function getBridgeHealth(): Promise<DebugFeatureHealth> {
  return invoke<DebugFeatureHealth>("bridge_health");
}

/**
 * Freighter signing self-test (`bridge_selftest`). It opens the user's browser
 * and never submits; only call it from an explicit action button.
 */
export async function bridgeSelftest(xdr: string): Promise<DebugBridgeOutcome> {
  return invoke<DebugBridgeOutcome>("bridge_selftest", { xdr });
}
