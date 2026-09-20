/**
 * Live wiring for the Schedules panel and the voice schedule tools (W6b).
 *
 * This is the only place that binds the pure `@/lib/schedules` helpers to real
 * network dependencies (RPC, the `polaris_guard` client, the SAC allowance
 * reader). It never signs and never submits: it builds unsigned XDR + summaries
 * for `runTx`/`executeIntent`, exactly like `@/lib/chain.ts` does for payments.
 *
 * The owner address, guard contract id and aliases come from `stellar_config`
 * (never bundled), and every missing piece throws a short error the caller can
 * show. The SAC contract id for each asset is derived locally from the pinned
 * asset (`Asset.contractId`), never taken from agent input.
 */
import { Asset, rpc as StellarRpc } from "@stellar/stellar-sdk";
import { defaultPaymentDeps, guard, parseAliasBook, schedule } from "@polaris/stellar";
import type { ChainToolResult, Intent } from "@polaris/interfaces";

import committedAliases from "../../../stellar/config/aliases.json";
import {
  cancelRequestFromIntent,
  deviceTimeZone,
  draftFromIntent,
  type ScheduleHealthFacts,
} from "./schedules.ts";
import { getStellarConfig } from "@/lib/stellarConfig";

const EXPLORER_BASE = "https://stellar.expert/explorer/testnet";

/** The env `alias -> address` map as alias-book entries (testnet only). */
function envAliasEntries(
  aliases: Record<string, string>,
): Record<string, { address: string; network: "testnet" }> {
  return Object.fromEntries(
    Object.entries(aliases).map(([alias, address]) => [alias, { address, network: "testnet" as const }]),
  );
}

/**
 * Builds the schedule dependencies from `stellar_config`. Throws a short,
 * user-safe error when the owner address or guard contract is missing; a voice
 * or panel caller maps that to a label ("Set POLARIS_OWNER_ADDRESS").
 */
export async function defaultScheduleDeps(): Promise<schedule.ScheduleDeps> {
  const config = await getStellarConfig();
  if (!config.ownerAddress) throw new Error("POLARIS_OWNER_ADDRESS is not set");
  if (!config.guardContractId) throw new Error("GUARD_CONTRACT_ID is not set");

  const { book } = parseAliasBook({
    ...committedAliases,
    ...envAliasEntries(config.aliases),
  });
  const server = new StellarRpc.Server(config.rpcUrl);
  // The pinned asset registry (USDC + XLM) comes from the payment deps; no
  // second list. The SAC contract id is derived locally from each spec.
  const assets = defaultPaymentDeps({
    ownerAddress: config.ownerAddress,
    aliases: book,
    horizonUrl: config.horizonUrl,
    networkPassphrase: config.networkPassphrase,
  }).assets;
  const guardAssetContracts: Record<string, string> = {};
  for (const code of ["USDC", "XLM"] as const) {
    const spec = assets.get(code);
    if (!spec) continue;
    const asset = spec.native ? Asset.native() : new Asset(spec.code, spec.issuer ?? "");
    guardAssetContracts[code] = asset.contractId(config.networkPassphrase);
  }

  const owner = config.ownerAddress;
  const guardId = config.guardContractId;
  const guardClient = guard.createGuardClient({
    contractId: guardId,
    rpc: server,
    networkPassphrase: config.networkPassphrase,
    source: owner,
  });

  return {
    ownerAddress: owner,
    aliases: book,
    guard: guardClient,
    assets,
    guardAssetContracts,
    networkPassphrase: config.networkPassphrase,
    explorerBase: EXPLORER_BASE,
    getAllowance: (assetContractId) =>
      guard.getAllowance(server, {
        assetContractId,
        from: owner,
        spender: guardId,
        networkPassphrase: config.networkPassphrase,
      }),
  };
}

/** The owner's upcoming schedules (next run local + UTC), for the panel list. */
export async function loadUpcoming(
  timeZone: string = deviceTimeZone(),
): Promise<schedule.UpcomingPayment[]> {
  const deps = await defaultScheduleDeps();
  return schedule.listUpcoming(deps)({ timeZone });
}

/** Builds the unsigned `create_schedule` for `runTx` from a validated Intent. */
export async function scheduleChainTool(intent: Intent): Promise<ChainToolResult> {
  const draft = draftFromIntent(intent);
  const deps = await defaultScheduleDeps();
  const result = await schedule.schedulePayment(deps)(draft);
  return { unsignedXdr: result.unsignedXdr, summary: result.summary };
}

/** Builds the unsigned `cancel_schedule` for `runTx` from a validated Intent. */
export async function cancelChainTool(intent: Intent): Promise<ChainToolResult> {
  const request = cancelRequestFromIntent(intent);
  const deps = await defaultScheduleDeps();
  const result = await schedule.cancelSchedule(deps)(request);
  return { unsignedXdr: result.unsignedXdr, summary: result.summary };
}

/**
 * Read-only facts for the Debug check. Every failure is captured into a field so
 * the check maps it to a single actionable line instead of throwing; it never
 * writes and never moves funds.
 */
export async function gatherScheduleHealth(): Promise<ScheduleHealthFacts> {
  const facts: ScheduleHealthFacts = {
    config: true,
    ownerConfigured: false,
    guardConfigured: false,
    listError: null,
    scheduleCount: 0,
    rulePresent: false,
    allowanceRaw: null,
  };

  let config: Awaited<ReturnType<typeof getStellarConfig>>;
  try {
    config = await getStellarConfig();
  } catch (error) {
    facts.config = false;
    facts.listError = error instanceof Error ? error.message : String(error);
    return facts;
  }
  facts.ownerConfigured = Boolean(config.ownerAddress);
  facts.guardConfigured = Boolean(config.guardContractId);
  if (!config.ownerAddress || !config.guardContractId) return facts;

  let deps: schedule.ScheduleDeps;
  try {
    deps = await defaultScheduleDeps();
  } catch (error) {
    facts.listError = error instanceof Error ? error.message : String(error);
    return facts;
  }

  try {
    const rows = await schedule.listUpcoming(deps)({ timeZone: deviceTimeZone() });
    facts.scheduleCount = rows.filter((row) => row.status !== "finished").length;
  } catch (error) {
    facts.listError = error instanceof Error ? error.message : String(error);
  }

  try {
    facts.rulePresent = (await deps.guard.getRule(deps.ownerAddress)) !== null;
  } catch {
    facts.rulePresent = false;
  }

  try {
    const assetSac = deps.guardAssetContracts["USDC"];
    if (assetSac) facts.allowanceRaw = (await deps.getAllowance(assetSac)).toString();
  } catch {
    facts.allowanceRaw = null;
  }

  return facts;
}
