import { getCaptureStatus } from "@/lib/polaris";
import { errorDetail, makeResult } from "@/debug/runner.ts";
import type { FeatureCheck } from "@/debug/types.ts";

/**
 * Microphone/capture state via `capture_status`. Read-only: it never starts or
 * stops a recording, so it is safe to run automatically.
 */
export default {
  id: "capture",
  title: "Microphone capture",
  milestone: "W0",
  async run() {
    try {
      const status = await getCaptureStatus();
      if (status.state === "error") {
        return makeResult(
          "fail",
          status.error ?? status.label ?? "capture is in the error state",
        );
      }
      const clip = status.recording
        ? `, last clip ${status.recording.durationMs} ms`
        : "";
      const label = status.label ? ` (${status.label})` : "";
      return makeResult("ok", `capture ${status.state}${label}${clip}`);
    } catch (error) {
      return makeResult("fail", `capture_status failed: ${errorDetail(error)}`);
    }
  },
} satisfies FeatureCheck;
