/**
 * Chain network readiness (milestone W4b).
 *
 * Answers, for a non-developer: is the app pointed at testnet, is the owner
 * wallet set and well-formed, does the alias book resolve the payment recipient,
 * and does Horizon actually serve the owner account (with its XLM balance)? That
 * last step is the only live proof that a payment could be built at all.
 *
 * Read-only: it never signs, submits or moves funds. A missing command on a
 * branch without W1 degrades to `warn` instead of failing the panel. The
 * decision logic lives in `@/debug/checkHelpers` (unit-tested).
 *
 * The chain package is imported **inside** `run`, not at module scope: the check
 * registry globs every check eagerly, so a static import here would pull the
 * whole Stellar SDK into the shell's eager bundle (W4b-2 MAJOR-2).
 */
import {
  DEFAULT_RECIPIENT_ALIAS,
  loadOwnerAccount,
  summarizeNetwork,
} from "@/debug/checkHelpers.ts";
import { getStellarConfigIfAvailable } from "@/debug/commands.ts";
import { errorDetail, makeResult } from "@/debug/runner.ts";
import type { FeatureCheck } from "@/debug/types.ts";

/** The live check. Read-only; safe for the panel's auto-run. */
export default {
  id: "network",
  title: "Testnet & owner account",
  milestone: "W4",
  async run() {
    try {
      const config = await getStellarConfigIfAvailable();
      if (config === null) {
        return summarizeNetwork({
          config: null,
          aliasBookResolved: false,
          recipientAlias: DEFAULT_RECIPIENT_ALIAS,
          recipientResolved: false,
          horizon: null,
        });
      }

      // Env aliases win over the committed book; both sides re-validate every
      // address, so a malformed entry is a fail rather than a silent skip.
      let aliasBookResolved = true;
      let recipientResolved = false;
      try {
        const { parseAliasBook } = await import("@polaris/stellar");
        const committed = (await import("../../../../stellar/config/aliases.json")).default;
        const { book } = parseAliasBook({ ...committed, ...config.aliases });
        // `resolveAlias` is not re-exported by the package root; the book is a
        // null-prototype object, so an own-property lookup is the same lookup.
        recipientResolved = Object.prototype.hasOwnProperty.call(book, DEFAULT_RECIPIENT_ALIAS);
      } catch {
        aliasBookResolved = false;
      }

      const horizon =
        config.horizonUrl && config.ownerAddress
          ? await loadOwnerAccount(config.horizonUrl, config.ownerAddress)
          : null;

      return summarizeNetwork({
        config,
        aliasBookResolved,
        recipientAlias: DEFAULT_RECIPIENT_ALIAS,
        recipientResolved,
        horizon,
      });
    } catch (error) {
      return makeResult("fail", `network check failed: ${errorDetail(error)}`);
    }
  },
} satisfies FeatureCheck;
