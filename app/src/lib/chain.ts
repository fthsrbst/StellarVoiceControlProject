/**
 * The shell's composition root for the A9 intent execution seam (W1: real
 * network config).
 *
 * `@polaris/agent` owns the *shape* of the path (chain tool → approval gate →
 * outcome) and knows nothing about the chain package. This file is the one place
 * that binds that shape to the real tools, so Owner B can replace an
 * implementation inside `@polaris/stellar` without touching the seam, the agent
 * core or the shell.
 *
 * Ownership boundary: the tools below are Owner B's. Do not change their
 * behaviour here — this module only selects, configures and injects them. The
 * mapping is total over the current `IntentKind` union minus `raw_tx` (which has
 * no dedicated tool and therefore settles as `unsupported`).
 *
 * ## Where the owner address and aliases come from (W1)
 *
 * Neither the owner address nor the recipient aliases are secrets, but they are
 * environment-specific, so they are **not** bundled. The Rust `stellar_config`
 * command (`getStellarConfig`) returns them validated; the env aliases
 * (`POLARIS_ALIASES`) are merged over the committed `stellar/config/aliases.json`,
 * with the environment winning. Owner B's chain tool is configured lazily on the
 * first intent, so a voice turn that never reaches the chain pays for neither the
 * SDK nor the config read. Missing owner address is refused with a clear label
 * ("Set POLARIS_OWNER_ADDRESS") and never guessed.
 *
 * The approver is **fail-closed by default**: a deny-all gate, not Touch ID.
 * Auto-approval is reachable only by explicitly setting
 * `POLARIS_ALLOW_AUTO_APPROVE=1` (for the stubbed demo); otherwise no value can
 * move without a real gesture. Replacing the selection below with the biometric
 * gate is the only change needed to activate the real approval flow; see
 * `agent/src/execution.ts` for the seam contract.
 */
import { executeIntent, resolveApprover, type ExecutionOutcome } from "@polaris/agent";
import type { Intent } from "@polaris/interfaces";

import { getStellarConfig } from "@/lib/stellarConfig";
import committedAliases from "../../../stellar/config/aliases.json";

/**
 * The single selection to replace when Touch ID lands (separate milestone).
 *
 * Defaults to fail closed. `POLARIS_ALLOW_AUTO_APPROVE=1` opts into the loud
 * auto-approval placeholder, which is safe only while the chain tools are
 * stubs; it exists so the stubbed demo can reach the execution seam. This is a
 * non-secret flag, exposed to the webview by the Vite `envPrefix`.
 */
const approver = resolveApprover(import.meta.env.POLARIS_ALLOW_AUTO_APPROVE === "1");

/** Thrown (and caught below) only when the owner wallet is not configured. */
const OWNER_MISSING = "POLARIS_OWNER_ADDRESS is not set";

let configured = false;
let configuring: Promise<void> | undefined;

/** The env `alias -> address` map as alias-book entries (testnet only). */
function envAliasEntries(
  aliases: Record<string, string>,
): Record<string, { address: string; network: "testnet" }> {
  return Object.fromEntries(
    Object.entries(aliases).map(([alias, address]) => [
      alias,
      { address, network: "testnet" as const },
    ]),
  );
}

/**
 * Reads the validated config once and installs Owner B's payment tool. Memoized
 * on success; a failure (no owner, a failed config read) is retried on the next
 * turn rather than cached.
 */
async function ensurePaymentsConfigured(): Promise<void> {
  if (configured) return;
  configuring ??= (async () => {
    const config = await getStellarConfig();
    if (!config.ownerAddress) {
      throw new Error(OWNER_MISSING);
    }
    const { configurePayments, defaultPaymentDeps, parseAliasBook } = await import(
      "@polaris/stellar"
    );
    // Env aliases win over the committed book, and `parseAliasBook` re-validates
    // every address, so a malformed entry is refused rather than paid.
    const { book } = parseAliasBook({
      ...committedAliases,
      ...envAliasEntries(config.aliases),
    });
    configurePayments(
      defaultPaymentDeps({
        ownerAddress: config.ownerAddress,
        aliases: book,
        horizonUrl: config.horizonUrl,
        networkPassphrase: config.networkPassphrase,
      }),
    );
    configured = true;
  })();
  try {
    await configuring;
  } finally {
    if (!configured) configuring = undefined;
  }
}

/**
 * Executes one validated intent down the single seam.
 *
 * The chain package is imported lazily, only when an intent actually exists: its
 * SDK is large, and a voice turn that never reaches the chain must not pay for
 * it at shell startup. Never throws — a missing owner, a failed config read and
 * every execution failure (including Owner B's `NotImplementedError` stubs) come
 * back as a labelled `ExecutionOutcome`, so the notch can show a short message
 * and settle instead of crashing or hanging.
 */
export async function executeApprovedIntent(intent: Intent): Promise<ExecutionOutcome> {
  try {
    await ensurePaymentsConfigured();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      status: "failed",
      intent,
      label: detail.includes("POLARIS_OWNER_ADDRESS") ? "Set POLARIS_OWNER_ADDRESS" : "Chain not configured",
      detail,
    };
  }
  const { depositTry, guardPolicy, sendPayment, swap } = await import("@polaris/stellar");
  const chainTools = {
    send: sendPayment,
    swap,
    guard_policy: guardPolicy,
    deposit: depositTry,
  } as const;
  return executeIntent(intent, { approver, chainTools });
}
