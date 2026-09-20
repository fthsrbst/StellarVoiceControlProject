/**
 * Submission wiring (milestone W4b): a **static** check.
 *
 * It answers one question without doing anything: is the submit path importable
 * and shaped correctly? It never builds, signs or submits a transaction, so it
 * is safe to run automatically. The live end-to-end proof is the real payment a
 * human makes with Freighter.
 */
import { submitSignedTx } from "@polaris/stellar";
import { explorerTxUrl } from "@/lib/signing";
import { errorDetail, makeResult } from "@/debug/runner.ts";
import type { FeatureCheck } from "@/debug/types.ts";

/** Confirms the submit seam exists and the explorer link is the testnet one. */
export default {
  id: "submit",
  title: "Transaction submission",
  milestone: "W4",
  async run() {
    try {
      if (typeof submitSignedTx !== "function") {
        return makeResult("fail", "submitSignedTx is not exported by @polaris/stellar");
      }
      const url = explorerTxUrl("0".repeat(64));
      if (!url.startsWith("https://stellar.expert/explorer/testnet/tx/")) {
        return makeResult("fail", `explorer URL is not the testnet link: ${url}`);
      }
      return makeResult(
        "ok",
        "submitSignedTx is wired; the explorer link is stellar.expert testnet (no live submit performed)",
      );
    } catch (error) {
      return makeResult("fail", `submission wiring is broken: ${errorDetail(error)}`);
    }
  },
} satisfies FeatureCheck;
