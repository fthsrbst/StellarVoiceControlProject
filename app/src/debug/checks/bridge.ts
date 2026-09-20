/**
 * Freighter signing bridge readiness (milestone W4b).
 *
 * `bridge_health` answers whether the Rust loopback server can bind, whether the
 * bridge assets are servable, whether the owner is configured and which browser
 * will open. The **action** "Test Freighter signing (no funds)" builds an
 * unsigned native-XLM payment the owner pays to itself with sequence number
 * exactly `0` and passes its XDR to `bridge_selftest`. A sequence-0 envelope can
 * never be applied on-chain, and Rust additionally refuses any XDR whose source
 * is not the configured owner — so the self-test cannot move funds even if the
 * user approved it in Freighter.
 *
 * The action opens the user's browser; it is never run automatically.
 */
import { bridgeSelftest, getBridgeHealth, getStellarConfigIfAvailable } from "@/debug/commands.ts";
import { bridgeSelftestResult, buildSelfTestXdr } from "@/debug/checkHelpers.ts";
import { errorDetail, makeResult } from "@/debug/runner.ts";
import type { CheckAction, FeatureCheck } from "@/debug/types.ts";

/**
 * The self-test action. It reads the owner from `stellar_config` (never a
 * hardcoded address), builds the throwaway XDR, and hands it to `bridge_selftest`.
 * Every failure is a labelled result, never a throw.
 */
export function createBridgeSelftestAction(): CheckAction {
  return {
    id: "freighter-selftest",
    label: "Test Freighter signing (no funds)",
    description:
      "Opens your browser to sign a throwaway testnet payment with Freighter. Nothing is submitted and no funds move.",
    async run() {
      try {
        const config = await getStellarConfigIfAvailable();
        const owner = config?.ownerAddress;
        if (!owner) {
          return makeResult("fail", "POLARIS_OWNER_ADDRESS is not set; cannot build the test payment");
        }
        const xdr = await buildSelfTestXdr(owner);
        return bridgeSelftestResult(await bridgeSelftest(xdr));
      } catch (error) {
        return makeResult("fail", `Freighter self-test failed: ${errorDetail(error)}`);
      }
    },
  };
}

/**
 * Non-destructive bridge readiness. Degrades to `unknown` when the Rust half is
 * not merged yet, so the panel works before W4b-1 lands.
 */
export default {
  id: "bridge",
  title: "Freighter signing bridge",
  milestone: "W4",
  async run() {
    try {
      const health = await getBridgeHealth();
      return makeResult(health.status, health.detail);
    } catch (error) {
      return makeResult("unknown", `bridge_health is not present on this build: ${errorDetail(error)}`);
    }
  },
  actions: [createBridgeSelftestAction()],
} satisfies FeatureCheck;
