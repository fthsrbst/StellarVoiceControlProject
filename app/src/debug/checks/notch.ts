import { getNotchGeometry } from "@/lib/polaris";
import { getNotchWindowFlags } from "@/debug/commands.ts";
import { errorDetail, makeResult } from "@/debug/runner.ts";
import type { FeatureCheck } from "@/debug/types.ts";

/**
 * Overlay geometry and the live AppKit flags that make it float over a
 * fullscreen Space. Both come from Rust readbacks of the real window, so this is
 * the closest an automated check can get to the A15 fullscreen fix; whether it
 * *visually* floats still needs a human eye.
 */
export default {
  id: "notch",
  title: "Notch overlay",
  milestone: "W0",
  async run() {
    try {
      const [geometry, flags] = await Promise.all([
        getNotchGeometry(),
        getNotchWindowFlags(),
      ]);
      const size = `${Math.round(geometry.idleWidth)}×${Math.round(geometry.idleHeight)} pt`;
      if (flags.activationPolicy !== "accessory") {
        return makeResult(
          "warn",
          `overlay ${size}, but activationPolicy=${flags.activationPolicy}; fullscreen layering may fail`,
        );
      }
      if (!flags.fullScreenAuxiliary || !flags.canJoinAllSpaces) {
        return makeResult(
          "warn",
          `overlay ${size}, level ${flags.level}, but fullScreenAuxiliary=${flags.fullScreenAuxiliary} canJoinAllSpaces=${flags.canJoinAllSpaces}`,
        );
      }
      return makeResult(
        "ok",
        `overlay ${size}, level ${flags.level}, accessory; can float over fullscreen`,
      );
    } catch (error) {
      return makeResult("fail", `overlay flags failed: ${errorDetail(error)}`);
    }
  },
} satisfies FeatureCheck;
