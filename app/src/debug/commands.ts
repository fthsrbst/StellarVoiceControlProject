/**
 * Tauri commands used only by the Debug panel and its checks (step W0b).
 *
 * `@/lib/polaris` owns the shared seam commands (`app_info`, `capture_status`, …);
 * the commands here are debug-only and would clutter it. They are still
 * centralised so no check calls `invoke` directly.
 */
import { invoke } from "@tauri-apps/api/core";

/** The `notch_window_flags` payload (mirrors `NotchWindowFlags` in Rust). */
export interface NotchWindowFlags {
  /** Raw `NSWindowLevel` (`NSPopUpMenuWindowLevel` is 101). */
  level: number;
  collectionBehavior: number;
  fullScreenAuxiliary: boolean;
  canJoinAllSpaces: boolean;
  focusable: boolean;
  activationPolicy: "regular" | "accessory" | "prohibited" | "unknown" | "unsupported";
}

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
}

/** Live AppKit flags of the overlay window. */
export async function getNotchWindowFlags(): Promise<NotchWindowFlags> {
  return invoke<NotchWindowFlags>("notch_window_flags");
}

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
