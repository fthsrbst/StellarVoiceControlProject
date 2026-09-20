/**
 * Wallet readiness (milestone W6).
 *
 * Answers "is the Wallet panel showing real data right now?": is the owner
 * configured, is Horizon reachable, does the owner account exist on testnet, and
 * how many balances did it return. Read-only: it never signs or moves funds.
 */
import { getStellarConfigIfAvailable } from "@/debug/commands.ts";
import { errorDetail, makeResult } from "@/debug/runner.ts";
import type { FeatureCheck } from "@/debug/types.ts";
import { fetchOwnerAccount } from "@/lib/history.ts";

export default {
  id: "wallet",
  title: "Wallet balances (Horizon)",
  milestone: "W6",
  async run() {
    try {
      const config = await getStellarConfigIfAvailable();
      if (config === null) {
        return makeResult("warn", "stellar_config is not present on this build");
      }
      if (!config.horizonUrl) {
        return makeResult("fail", "horizonUrl is not configured; the wallet cannot read balances");
      }
      if (!config.ownerAddress) {
        return makeResult("warn", "POLARIS_OWNER_ADDRESS is not set; the wallet is empty");
      }

      const account = await fetchOwnerAccount(config.horizonUrl, config.ownerAddress);
      switch (account.status) {
        case "offline":
          return makeResult("fail", `Horizon is unreachable at ${config.horizonUrl}`);
        case "not_found":
          return makeResult(
            "fail",
            `owner account ${config.ownerAddress} was not found on testnet; fund it with Friendbot`,
          );
        case "ok": {
          const xlm = account.balances.find((balance) => balance.native);
          return makeResult(
            "ok",
            `${account.balances.length} balance(s); XLM ${xlm?.balance ?? "0"}`,
          );
        }
      }
    } catch (error) {
      return makeResult("fail", `wallet check failed: ${errorDetail(error)}`);
    }
  },
} satisfies FeatureCheck;
