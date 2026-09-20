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
import { isTauri } from "@tauri-apps/api/core";
import {
  createDenyApprover,
  executeIntent,
  resolveApprover,
  type ExecutionOutcome,
  type IntentApprover,
} from "@polaris/agent";
import type { Intent } from "@polaris/interfaces";

import { getStellarConfig } from "@/lib/stellarConfig";
import { createTouchIdApprover, defaultApproverDeps, type ApproverDeps } from "@/lib/approver";
import {
  defaultSigningDeps,
  signAndSubmit,
  type SubmittedOutcome,
  type SigningDeps,
} from "@/lib/signing";
import committedAliases from "../../../stellar/config/aliases.json";

/**
 * The approver selection (W4b). **Fail-closed by default.**
 *
 * * In a real Tauri runtime the Touch ID gate (W3) is the approver: it registers
 *   the exact blob, opens the approval card and returns a decision only when the
 *   gate reports `authorized`.
 * * `POLARIS_ALLOW_AUTO_APPROVE=1` still opts into the loud auto-approval
 *   placeholder — but **only outside** a Tauri runtime (the CLI/demo path). In
 *   the app the gate always wins, so the placeholder can never move real value.
 * * Everything else is the deny-all gate.
 *
 * The Touch ID approver is built lazily (its event subscription is async), so a
 * turn that never reaches the chain pays for nothing.
 */
let approverPromise: Promise<IntentApprover> | undefined;

async function resolveRuntimeApprover(): Promise<IntentApprover> {
  if (isTauri()) {
    const deps: ApproverDeps = await defaultApproverDeps();
    return createTouchIdApprover(deps);
  }
  if (import.meta.env.POLARIS_ALLOW_AUTO_APPROVE === "1") {
    return resolveApprover(true);
  }
  return createDenyApprover();
}

function approverFor(): Promise<IntentApprover> {
  approverPromise ??= resolveRuntimeApprover();
  return approverPromise;
}

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
    // The anchor tools (`depositTry` / `withdrawTry`) need a session with the
    // shell signer. `createAnchorSigner` routes sequence-0 challenges to the
    // wallet-only Rust command and everything else to the Touch ID pipeline.
    const { anchor } = await import("@polaris/stellar");
    const { createAnchorSigner } = await import("@/lib/anchor");
    anchor.configureAnchor({ signer: createAnchorSigner() });
    configured = true;
  })();
  try {
    await configuring;
  } finally {
    if (!configured) configuring = undefined;
  }
}

/**
 * Executes one validated intent down the single seam: build → approve → sign →
 * submit.
 *
 * The chain package is imported lazily, only when an intent actually exists: its
 * SDK is large, and a voice turn that never reaches the chain must not pay for
 * it at shell startup. Never throws — a missing owner, a failed config read and
 * every execution failure (including Owner B's `NotImplementedError` stubs) come
 * back as a labelled `SubmittedOutcome`, so the notch can show a short message
 * and settle instead of crashing or hanging.
 *
 * On success the returned outcome carries `txHash`/`explorerUrl` (and the raw
 * `ExecutionOutcome` fields), which the shell's speak path announces. A failure
 * anywhere in the values above — including the wallet declining, an integrity
 * failure or a rejected submission — is a labelled failure with no `txHash`.
 */
export async function executeApprovedIntent(
  intent: Intent,
  signingDeps?: Partial<SigningDeps>,
): Promise<SubmittedOutcome> {
  const deps: SigningDeps = {
    ...defaultSigningDeps,
    ...signingDeps,
  };
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
  const { depositTry, guardPolicy, sendPayment, swap, withdrawTry } = await import(
    "@polaris/stellar"
  );
  // W5b/M1: deposit/withdraw are multi-step anchor flows, not one tool XDR.
  // Drive the same `AnchorSession` the panel uses, so the SEP-10 challenge is
  // signed wallet-only and every value-moving step goes through the Touch ID
  // pipeline. This also keeps a sequence-0 challenge out of `bridge_sign`.
  if (intent.kind === "deposit" || intent.kind === "withdraw") {
    const { runAnchorIntent } = await import("@/lib/anchor");
    return runAnchorIntent(intent);
  }
  const chainTools = {
    send: sendPayment,
    swap,
    guard_policy: guardPolicy,
    deposit: depositTry,
    withdraw: withdrawTry,
  } as const;
  const approver = await approverFor();
  const outcome: ExecutionOutcome = await executeIntent(intent, { approver, chainTools });
  return signAndSubmit(outcome, deps);
}
