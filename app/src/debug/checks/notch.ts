import { getShellGeometry } from "@/notch/shellBridge";
import { errorDetail, makeResult } from "@/debug/runner.ts";
import type { FeatureCheck } from "@/debug/types.ts";

/**
 * Overlay geometry readback. Rust owns the measured, per-state frame (the shell
 * rewrite replaced the old flat `NotchGeometry` with `ShellGeometry` and dropped
 * the `notch_window_flags` command), so this checks that geometry resolves and
 * reports the resting size. Whether the overlay *visually* floats over another
 * app's fullscreen Space still needs a human eye; the activation policy is
 * printed by Rust at startup.
 */
export default {
  id: "notch",
  title: "Notch overlay",
  milestone: "W0",
  async run() {
    try {
      const geometry = await getShellGeometry();
      const collapsed = geometry.states.find((state) => state.name === "collapsed");
      if (!collapsed) {
        return makeResult("fail", "geometry has no collapsed state");
      }
      return makeResult(
        "ok",
        `overlay ${Math.round(collapsed.width)}×${Math.round(collapsed.height)} pt on a ` +
          `${Math.round(geometry.notch.screenWidth)}×${Math.round(geometry.notch.screenHeight)} display, ` +
          `safeTop ${Math.round(geometry.notch.safeTop)}, ${geometry.states.length} states`,
      );
    } catch (error) {
      return makeResult("fail", `overlay geometry failed: ${errorDetail(error)}`);
    }
  },
} satisfies FeatureCheck;
