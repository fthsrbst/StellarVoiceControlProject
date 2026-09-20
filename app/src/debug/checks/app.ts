import { getAppInfo } from "@/lib/polaris";
import { errorDetail, makeResult } from "@/debug/runner.ts";
import type { FeatureCheck } from "@/debug/types.ts";

/**
 * Build/network metadata via `app_info`. The most basic liveness check: if the
 * webview can read it, the Rust core answered.
 */
export default {
  id: "app",
  title: "App shell",
  milestone: "W0",
  async run() {
    try {
      const info = await getAppInfo();
      return makeResult(
        "ok",
        `${info.name} ${info.version} · ${info.network} · Tauri ${info.tauriVersion}`,
      );
    } catch (error) {
      return makeResult("fail", `app_info failed: ${errorDetail(error)}`);
    }
  },
} satisfies FeatureCheck;
