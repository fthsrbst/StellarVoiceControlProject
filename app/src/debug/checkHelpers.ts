/**
 * Pure helpers behind the W4b Debug checks.
 *
 * `docs/debug-panel.md` keeps helper modules **outside** `checks/` on purpose:
 * the registry globs every `checks/*.ts` as a `FeatureCheck`, and only the pure,
 * Tauri-free logic can be unit-tested under `node:test`. The check files
 * (`checks/network.ts`, `checks/bridge.ts`, `checks/approval.ts`) are thin
 * wrappers that gather live facts and hand them here; the decisions live here.
 */
import { makeResult } from "./runner.ts";
import type { CheckResult } from "./types.ts";
import type { DebugFeatureHealth } from "./commands.ts";

/* ------------------------------------------------------------------ *
 * Network
 * ------------------------------------------------------------------ */

/** The alias the demo/testnet flow pays by default (`.env.example`). */
export const DEFAULT_RECIPIENT_ALIAS = "acc2";

/** The owner account facts Horizon returns, narrowed to what a check needs. */
export interface OwnerAccountFacts {
  exists: boolean;
  /** Native XLM balance string, when the account exists. */
  xlmBalance?: string;
}

/** Plain facts the network summary is built from (injected, so it is testable). */
export interface NetworkFacts {
  /** The `stellar_config` payload, or `null` when the command is absent. */
  config: {
    network?: string;
    horizonUrl?: string;
    ownerAddress?: string | null;
  } | null;
  /** Whether the alias book parsed without error. */
  aliasBookResolved: boolean;
  recipientAlias: string;
  recipientResolved: boolean;
  /** `null` when Horizon could not be reached at all. */
  horizon: OwnerAccountFacts | null;
}

/** A 56-char `G...` StrKey shape check (the checksum is validated in Rust). */
const ADDRESS = /^G[A-Z2-7]{55}$/;

/**
 * Maps gathered network facts to one Debug result. Severity is the worst
 * finding: a missing command or owner is a `warn`; a wrong network, a malformed
 * owner, an unresolvable alias or a missing/unfunded account is a `fail`; a
 * funded owner on testnet is an `ok` that shows the balance.
 */
export function summarizeNetwork(facts: NetworkFacts): CheckResult {
  const { config } = facts;
  if (config === null) {
    return makeResult("warn", "stellar_config is not present on this build");
  }
  if (config.network && config.network !== "testnet") {
    return makeResult("fail", `network is "${config.network}" but Polaris is testnet-only`);
  }
  const owner = config.ownerAddress;
  if (!owner) {
    return makeResult("warn", "POLARIS_OWNER_ADDRESS is not set; sending is disabled");
  }
  if (!ADDRESS.test(owner)) {
    return makeResult("fail", `owner address is not a valid G… key: ${owner}`);
  }
  if (!facts.aliasBookResolved) {
    return makeResult("fail", "the alias book is not configured");
  }
  if (!facts.recipientResolved) {
    return makeResult(
      "fail",
      `alias "${facts.recipientAlias}" does not resolve; add it to POLARIS_ALIASES`,
    );
  }
  if (facts.horizon === null) {
    return makeResult("fail", `Horizon is unreachable at ${config.horizonUrl ?? "the default URL"}`);
  }
  if (!facts.horizon.exists) {
    return makeResult(
      "fail",
      `owner account ${owner} was not found on testnet; fund it (Friendbot) before sending`,
    );
  }
  const balance = facts.horizon.xlmBalance ?? "0";
  if (Number.parseFloat(balance) <= 0) {
    return makeResult("fail", `owner account exists but has ${balance} XLM; fund it before sending`);
  }
  return makeResult(
    "ok",
    `testnet · owner ${owner} · alias ${facts.recipientAlias} · ${balance} XLM`,
  );
}

/**
 * Reads the owner account from Horizon. Returns `null` when Horizon could not be
 * reached at all (a network failure), distinct from `{ exists: false }` (a 404,
 * i.e. the account was never funded).
 */
export async function loadOwnerAccount(
  horizonUrl: string,
  owner: string,
): Promise<OwnerAccountFacts | null> {
  try {
    const response = await fetch(`${horizonUrl}/accounts/${owner}`, {
      headers: { accept: "application/json" },
    });
    if (response.status === 404) return { exists: false };
    if (!response.ok) return null;
    const body = (await response.json()) as {
      balances?: { asset_type?: string; balance?: string }[];
    };
    const native = body.balances?.find((entry) => entry.asset_type === "native");
    return native?.balance !== undefined
      ? { exists: true, xlmBalance: native.balance }
      : { exists: true };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Touch ID approval
 * ------------------------------------------------------------------ */

/** Maps a `FeatureHealth` from Rust onto a `CheckResult` (scrubbed by `makeResult`). */
export function mapHealthToResult(health: DebugFeatureHealth): CheckResult {
  return makeResult(health.status, health.detail);
}

/** The result of the Touch ID self-test action, mirroring the Rust status. */
export function approvalSelftestResult(health: DebugFeatureHealth): CheckResult {
  switch (health.status) {
    case "ok":
      return makeResult("ok", "Touch ID self-test passed; no funds were moved");
    case "warn":
      // A cancelled prompt is a user choice, not a broken gate.
      return makeResult("warn", health.detail);
    default:
      return makeResult("fail", health.detail);
  }
}

/* ------------------------------------------------------------------ *
 * Freighter bridge
 * ------------------------------------------------------------------ */

/** The human label for each `BridgeOutcome` failure code. */
export const BRIDGE_CODE_LABELS: Record<string, string> = {
  rejected: "the wallet declined to sign",
  address_mismatch: "the wallet's account is not the configured owner",
  network_mismatch: "the wallet is not on Testnet",
  wallet_unavailable: "Freighter was not reachable",
  not_authorized: "the signing gate was not authorized",
  integrity: "the returned signature did not verify",
  timeout: "no signature arrived before the timeout",
  error: "the bridge reported an error",
};

/** The self-test action's outcome, as one actionable line. */
export function bridgeSelftestResult(outcome: {
  ok: boolean;
  txHash?: string;
  code?: string;
  message?: string;
}): CheckResult {
  if (outcome.ok) {
    return makeResult(
      "ok",
      `Freighter signed the throwaway transaction (hash ${outcome.txHash ?? "?"}); nothing was submitted`,
    );
  }
  const label = BRIDGE_CODE_LABELS[outcome.code ?? "error"] ?? "the bridge reported an error";
  const detail = outcome.message ? `${label}: ${outcome.message}` : label;
  return makeResult("fail", detail);
}

/**
 * Builds the throwaway self-test XDR: a 1 XLM native payment from the owner to
 * itself, sequence number `0`. Sequence 0 makes the envelope unapplyable, so the
 * test is safe by construction. Requires a well-formed `G...` owner.
 */
export async function buildSelfTestXdr(owner: string): Promise<string> {
  const { Account, Asset, Operation, TimeoutInfinite, TransactionBuilder } = await import(
    "@stellar/stellar-sdk"
  );
  const { TESTNET } = await import("@polaris/stellar");
  // `TransactionBuilder.build()` emits `sequenceNumber + 1`, so a synthetic
  // account at -1 yields the sequence-0 envelope the Rust self-test requires.
  // Sequence 0 makes the transaction unapplyable on-chain; it is never loaded
  // from the network and never submitted.
  const account = new Account(owner, "-1");
  return new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: TESTNET.networkPassphrase,
  })
    .addOperation(Operation.payment({ destination: owner, asset: Asset.native(), amount: "1" }))
    .setTimeout(TimeoutInfinite)
    .build()
    .toXDR();
}
