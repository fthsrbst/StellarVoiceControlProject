/**
 * Touch ID approval readiness (milestone W4b).
 *
 * The production gate is W3's `biometric_health` (a non-prompting
 * `canEvaluatePolicy` probe). This check maps that command's facts onto a Debug
 * result and exposes the real prompt as an **action**: "Test Touch ID" calls
 * `biometric_selftest`, which shows the prompt and moves no funds. The action is
 * never run automatically.
 */
import { biometricSelftest, getBiometricHealthIfAvailable } from "@/debug/commands.ts";
import { approvalSelftestResult, mapHealthToResult } from "@/debug/checkHelpers.ts";
import { errorDetail, makeResult } from "@/debug/runner.ts";
import type { FeatureCheck } from "@/debug/types.ts";

/**
 * Non-destructive Touch ID probe. Degrades to `unknown` when W3's command is
 * missing (a branch without it), so the panel still works.
 */
export default {
  id: "approval",
  title: "Touch ID approval gate",
  milestone: "W4",
  async run() {
    try {
      const health = await getBiometricHealthIfAvailable();
      if (health === null) {
        return makeResult("unknown", "biometric_health is not present on this build");
      }
      return mapHealthToResult(health);
    } catch (error) {
      return makeResult("fail", `biometric_health failed: ${errorDetail(error)}`);
    }
  },
  actions: [
    {
      id: "touch-id",
      label: "Test Touch ID (no funds)",
      description: "Shows the real Touch ID prompt; nothing is signed or sent.",
      async run() {
        try {
          return approvalSelftestResult(await biometricSelftest());
        } catch (error) {
          return makeResult("fail", `biometric_selftest failed: ${errorDetail(error)}`);
        }
      },
    },
  ],
} satisfies FeatureCheck;
