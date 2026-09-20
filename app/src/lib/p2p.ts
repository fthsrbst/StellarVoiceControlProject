/**
 * The shell's P2P composition root (W8).
 *
 * It binds the voice intents (`p2p_offer` / `p2p_accept` / `p2p_confirm`) and
 * the P2P panel to `@polaris/stellar`'s escrow client. Like `chain.ts`, the
 * heavy SDK is imported lazily, and the contract id is read from
 * `stellar_config` (`POLARIS_P2P_CONTRACT_ID`) — never hard-coded.
 *
 * Configuration is fail-closed: a missing owner or contract id raises a
 * `not_configured` error, so the execution seam labels it "Chain not configured"
 * and the panel shows a plain "set the env" notice. Nothing here signs,
 * submits or holds a secret; every built call goes through `txPipeline`.
 */
import type { ChainTool, ChainToolResult } from "@polaris/interfaces";
import type { Offer, P2pCall, P2pClient } from "@polaris/stellar";

import { getStellarConfig } from "@/lib/stellarConfig";
import { formatTokenAmount } from "@/lib/p2pView";

/** Error shape the execution seam recognises as a missing-config refusal. */
function notConfigured(message: string): Error & { code: "not_configured" } {
  const error = new Error(message) as Error & { code: "not_configured" };
  error.code = "not_configured";
  return error;
}

/** Everything a caller needs once the chain config is valid. */
export interface P2pContext {
  client: P2pClient;
  owner: string;
  /** Network passphrase used to derive the token SAC contract id. */
  networkPassphrase: string;
}

let contextPromise: Promise<P2pContext> | undefined;

/**
 * Reads the validated config once and builds the escrow client. Memoized on
 * success; a failure (no owner, no contract id) is retried on the next call
 * rather than cached, so setting the env and reopening the panel recovers.
 */
export function getP2pContext(): Promise<P2pContext> {
  contextPromise ??= (async () => {
    const config = await getStellarConfig();
    if (!config.ownerAddress) {
      throw notConfigured("POLARIS_OWNER_ADDRESS is not set");
    }
    if (!config.p2pContractId) {
      throw notConfigured("POLARIS_P2P_CONTRACT_ID is not set");
    }
    const { p2p } = await import("@polaris/stellar");
    const { rpc } = await import("@stellar/stellar-sdk");
    const server = new rpc.Server(config.rpcUrl, {
      allowHttp: config.rpcUrl.startsWith("http://"),
    });
    const client = p2p.createP2pClient({
      contractId: config.p2pContractId,
      rpc: server,
      networkPassphrase: config.networkPassphrase,
      source: config.ownerAddress,
    });
    return { client, owner: config.ownerAddress, networkPassphrase: config.networkPassphrase };
  })();
  return contextPromise.catch((error: unknown) => {
    contextPromise = undefined;
    throw error;
  });
}

/** The token's SAC contract id for the sold asset (USDC on testnet). */
async function tokenSac(asset: string, networkPassphrase: string): Promise<string> {
  const { defaultAssetRegistry, toSdkAsset } = await import("@polaris/stellar");
  const spec = defaultAssetRegistry().get(asset);
  if (!spec) {
    throw notConfigured(`P2P sell of ${asset} is not a supported asset`);
  }
  return toSdkAsset(spec).contractId(networkPassphrase);
}

/** The default offer lifetime in seconds (mirrors `@polaris/stellar`). */
export const P2P_OFFER_TTL_SECONDS = 86_400n;

/** Builds the unsigned `create_offer` call from a validated form/intent. */
export async function createP2pOfferCall(
  asset: string,
  amount: string,
  priceTry: string,
  ttlSecs: bigint = P2P_OFFER_TTL_SECONDS,
): Promise<P2pCall> {
  const { client, owner, networkPassphrase } = await getP2pContext();
  const { guard, p2p } = await import("@polaris/stellar");
  const token = await tokenSac(asset, networkPassphrase);
  return client.createOffer(owner, token, guard.toRawUnits(amount), p2p.tryToKurus(priceTry), ttlSecs);
}

/** The five write builders the panel can trigger, minus `create_offer`. */
export type P2pTradeAction = "accept" | "confirm" | "cancel" | "reclaim";

/** Prepends the offer's display terms to a call summary (display labels only). */
function withTerms(call: P2pCall, terms: string[]): P2pCall {
  return { ...call, summary: { ...call.summary, lines: [...terms, ...call.summary.lines] } };
}

/**
 * The offer's terms for the approval card, so a misheard/hallucinated offer id
 * is not approved blind. The signed payload is still the decoded XDR; these are
 * display labels.
 */
async function acceptTerms(offer: Offer): Promise<string[]> {
  const { p2p } = await import("@polaris/stellar");
  return [
    `Take offer #${offer.id}: ${formatTokenAmount(offer.amount)} tokens for ${p2p.kurusToTry(offer.price_try_kurus)} TRY`,
    `Seller: ${offer.seller}`,
  ];
}

/** Builds the unsigned call for the next action on an offer. */
export async function buildP2pActionCall(
  action: P2pTradeAction,
  offer: Offer,
): Promise<P2pCall> {
  const { client, owner } = await getP2pContext();
  switch (action) {
    case "accept":
      return withTerms(await client.accept(owner, offer.id), await acceptTerms(offer));
    case "confirm":
      return client.confirmFiat(owner, offer.id);
    case "cancel":
      return client.cancel(owner, offer.id);
    case "reclaim":
      return client.reclaim(owner, offer.id);
  }
}

/** Strips the digest from a call; `ChainToolResult` is the voice seam's shape. */
function asToolResult(call: P2pCall): ChainToolResult {
  return { unsignedXdr: call.unsignedXdr, summary: call.summary };
}

function requireOfferId(intent: { offerId?: number }): number {
  if (typeof intent.offerId !== "number" || !Number.isInteger(intent.offerId) || intent.offerId < 0) {
    throw new Error("a P2P offer id is required");
  }
  return intent.offerId;
}

/** Voice tool: "sell 100 USDC for 3400 TRY". */
export const p2pOfferTool: ChainTool = async (intent) => {
  if (typeof intent.priceTry !== "string") {
    throw new Error("p2p_offer requires a TRY price");
  }
  return asToolResult(await createP2pOfferCall(intent.asset, intent.amount, intent.priceTry));
};

/** Voice tool: "take offer 3". Fetches the terms so the card shows what is taken. */
export const p2pAcceptTool: ChainTool = async (intent) => {
  const { client, owner } = await getP2pContext();
  const offerId = BigInt(requireOfferId(intent));
  const offer = await client.getOffer(offerId);
  if (!offer) {
    throw new Error(`offer #${offerId} was not found`);
  }
  const call = await client.accept(owner, offerId);
  return asToolResult(withTerms(call, await acceptTerms(offer)));
};

/** Voice tool: "confirm payment received on offer 3". */
export const p2pConfirmTool: ChainTool = async (intent) => {
  const { client, owner } = await getP2pContext();
  return asToolResult(await client.confirmFiat(owner, BigInt(requireOfferId(intent))));
};

/** Panel tool: cancel an open offer. */
export const p2pCancelTool: ChainTool = async (intent) => {
  const { client, owner } = await getP2pContext();
  return asToolResult(await client.cancel(owner, BigInt(requireOfferId(intent))));
};

/** Panel tool: reclaim after the buyer missed the pay deadline. */
export const p2pReclaimTool: ChainTool = async (intent) => {
  const { client, owner } = await getP2pContext();
  return asToolResult(await client.reclaim(owner, BigInt(requireOfferId(intent))));
};
