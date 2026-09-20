/**
 * Public types for the `polaris_p2p_escrow` client (W8).
 *
 * The contract is **contract-id parametrised** like the guard client (D9):
 * nothing here hard-codes the deployed id. `createP2pClient` takes the id as an
 * option, so the app can run against whichever testnet deployment is configured
 * (`POLARIS_P2P_CONTRACT_ID`) and a future v2 can run side by side.
 *
 * `Offer` mirrors the contract struct exactly (snake_case) so a decoded value
 * is usable directly. The `state` union mirrors the contract enum; the client
 * normalises whatever `scValToNative` returns into this union.
 */
import type { rpc as StellarRpc } from "@stellar/stellar-sdk";
import type { ChainToolResult } from "@polaris/interfaces";

/** The subset of `rpc.Server` the client uses; injected so tests script it. */
export type P2pRpcLike = Pick<StellarRpc.Server, "getAccount" | "simulateTransaction">;

/** The offer lifecycle state machine (contract enum). */
export type OfferState = "Open" | "Accepted" | "Settled" | "Cancelled" | "Expired";

export const OFFER_STATES: readonly OfferState[] = [
  "Open",
  "Accepted",
  "Settled",
  "Cancelled",
  "Expired",
];

/** `Offer` as defined in the contract. `0n` timestamps mean "not set yet". */
export interface Offer {
  id: bigint;
  seller: string;
  /** SAC / SEP-41 token address the seller locked. */
  token: string;
  /** Raw token units (7 decimals for the demo stablecoin). */
  amount: bigint;
  /** Asking price in TRY kurus (TRY * 100). */
  price_try_kurus: bigint;
  /** Unix seconds. */
  created_at: bigint;
  /** Unix seconds; after this the offer can no longer be accepted. */
  expires_at: bigint;
  /** The buyer, or `null` while the offer is open. */
  buyer: string | null;
  /** Unix seconds; `0n` until accepted. */
  accepted_at: bigint;
  /** Unix seconds; `0n` until accepted. */
  pay_deadline: bigint;
  state: OfferState;
}

/** The approval-card shape shared with the shell (`ChainToolResult["summary"]`). */
export type P2pSummary = ChainToolResult["summary"];

/** An unsigned, assembled P2P invocation plus its decoded summary and payload hash. */
export interface P2pCall {
  /** base64 XDR, unsigned. */
  unsignedXdr: string;
  summary: P2pSummary;
  /** hex sha256 of the transaction signature base (`tx.hash()`). */
  payloadHash: string;
}

/**
 * The client surface. Write methods take the exact contract arguments and
 * return an unsigned `P2pCall`; read methods simulate and decode. The first
 * actor argument is also the transaction source (the address that must sign).
 */
export interface P2pClient {
  readonly contractId: string;

  /** `create_offer(seller, token, amount, price_try_kurus, ttl_secs) -> u64`. */
  createOffer(
    seller: string,
    token: string,
    amount: bigint,
    priceTryKurus: bigint,
    ttlSecs: bigint,
  ): Promise<P2pCall>;
  /** `accept(buyer, offer_id)`. */
  accept(buyer: string, offerId: bigint): Promise<P2pCall>;
  /** `confirm_fiat(seller, offer_id)` — releases the locked tokens to the buyer. */
  confirmFiat(seller: string, offerId: bigint): Promise<P2pCall>;
  /** `cancel(seller, offer_id)` — only legal while the offer is Open. */
  cancel(seller: string, offerId: bigint): Promise<P2pCall>;
  /** `reclaim(seller, offer_id)` — after `pay_deadline` with no fiat confirmation. */
  reclaim(seller: string, offerId: bigint): Promise<P2pCall>;

  /** `get_offer(offer_id)`; `null` when the contract returns `None`. */
  getOffer(offerId: bigint): Promise<Offer | null>;
  /** `next_offer_id() -> u64`. */
  nextOfferId(): Promise<bigint>;
  /** `list_open(start, limit) -> Vec<Offer>`. */
  listOpen(start: bigint, limit: number): Promise<Offer[]>;
}

export interface P2pClientOptions {
  /** Deployed `polaris_p2p_escrow` contract id (from `POLARIS_P2P_CONTRACT_ID`). */
  contractId: string;
  /** Minimal injected RPC (`getAccount` / `simulateTransaction`). */
  rpc: P2pRpcLike;
  networkPassphrase: string;
  /** Account used to simulate reads (reads require no auth). */
  source: string;
  txTimeoutSeconds?: number;
  explorerBase?: string;
}
