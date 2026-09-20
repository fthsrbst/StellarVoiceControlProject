/**
 * P2P escrow readiness (milestone W8).
 *
 * Answers, for a non-developer: is the escrow contract configured, and can the
 * app actually read it? It calls the read-only `next_offer_id` view, which
 * proves the contract id, the RPC endpoint and the source account all work
 * together. Nothing is signed or submitted.
 *
 * `unknown` (with the reason) when the config/command is missing, so the check
 * degrades cleanly on a build without W8 or without `POLARIS_P2P_CONTRACT_ID`.
 */
import { getStellarConfigIfAvailable } from "@/debug/commands.ts";
import { errorDetail, makeResult } from "@/debug/runner.ts";
import type { FeatureCheck } from "@/debug/types.ts";
import { shortAddress } from "@/lib/p2pView";

/** The config fields this check needs; the debug type only mirrors a subset. */
interface P2pConfigView {
  ownerAddress?: string | null;
  p2pContractId?: string | null;
  rpcUrl?: string;
  networkPassphrase?: string;
}

export default {
  id: "p2p",
  title: "P2P escrow contract",
  milestone: "W8",
  async run() {
    try {
      const config = (await getStellarConfigIfAvailable()) as unknown as P2pConfigView | null;
      if (config === null) {
        return makeResult("unknown", "stellar_config is not present on this build");
      }
      const contractId = config.p2pContractId;
      if (!contractId) {
        return makeResult(
          "unknown",
          "POLARIS_P2P_CONTRACT_ID is not set; P2P offers are disabled",
        );
      }
      if (!config.ownerAddress) {
        return makeResult("warn", "POLARIS_OWNER_ADDRESS is not set; cannot read the P2P contract");
      }
      const [{ p2p }, { rpc }] = await Promise.all([
        import("@polaris/stellar"),
        import("@stellar/stellar-sdk"),
      ]);
      const rpcUrl = config.rpcUrl ?? "https://soroban-testnet.stellar.org";
      const client = p2p.createP2pClient({
        contractId,
        rpc: new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith("http://") }),
        networkPassphrase: config.networkPassphrase ?? "Test SDF Network ; September 2015",
        source: config.ownerAddress,
      });
      const next = await client.nextOfferId();
      return makeResult("ok", `P2P contract ${shortAddress(contractId)} reachable; next offer id ${next}`);
    } catch (error) {
      return makeResult("fail", `P2P contract read failed: ${errorDetail(error)}`);
    }
  },
} satisfies FeatureCheck;
