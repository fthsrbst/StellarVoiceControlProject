/**
 * The `polaris_p2p_escrow` client (W8).
 *
 * Every state-changing method returns an **unsigned, assembled** invocation
 * (`unsignedXdr`) plus a summary decoded from that exact XDR and the payload
 * hash the shell's Touch ID gate approves. Nothing is signed or submitted here.
 *
 * The contract id is a required option — never a constant — so the app can pick
 * the configured testnet deployment and a future v2 can run side by side (D9).
 */
import {
  BASE_FEE,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  rpc as StellarRpc,
  scValToNative,
} from "@stellar/stellar-sdk";
import type { xdr } from "@stellar/stellar-sdk";

import { fromRawUnits } from "../guard/amount.ts";
import { buildP2pCallSummary, decodeOffer, type P2pWriteFunction } from "./describe.ts";
import { P2pRefusal } from "./errors.ts";
import { kurusToTry } from "./amount.ts";
import type { Offer, P2pCall, P2pClient, P2pClientOptions } from "./types.ts";

const { Api, assembleTransaction } = StellarRpc;

/** Default transaction validity window (seconds), mirroring the guard client. */
export const DEFAULT_TX_TIMEOUT_SECONDS = 300;

/** Default offer lifetime the app offers in the UI (1 day). */
export const DEFAULT_OFFER_TTL_SECONDS = 86_400n;

const scAddress = (address: string): xdr.ScVal => nativeToScVal(address, { type: "address" });
const scI128 = (amount: bigint): xdr.ScVal => nativeToScVal(amount, { type: "i128" });
const scU64 = (n: bigint): xdr.ScVal => nativeToScVal(n, { type: "u64" });
const scU32 = (n: number): xdr.ScVal => nativeToScVal(n, { type: "u32" });

/** Build + simulate + assemble an unsigned write. */
async function buildWrite(
  rpc: P2pClientOptions["rpc"],
  opts: {
    contractId: string;
    method: string;
    args: xdr.ScVal[];
    source: string;
    networkPassphrase: string;
    txTimeoutSeconds: number;
  },
): Promise<string> {
  const account = await rpc.getAccount(opts.source);
  const contract = new Contract(opts.contractId);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: opts.networkPassphrase,
  })
    .addOperation(contract.call(opts.method, ...opts.args))
    .setTimeout(opts.txTimeoutSeconds)
    .build();
  const sim = await rpc.simulateTransaction(tx);
  if (Api.isSimulationError(sim)) {
    throw new P2pRefusal("simulation_failed", `${opts.method} simulation failed: ${sim.error}`);
  }
  return assembleTransaction(tx, sim).build().toXDR();
}

/** Simulate a read-only invocation and decode its return value. */
async function simulateRead(
  rpc: P2pClientOptions["rpc"],
  opts: {
    contractId: string;
    method: string;
    args: xdr.ScVal[];
    source: string;
    networkPassphrase: string;
    txTimeoutSeconds: number;
  },
): Promise<unknown> {
  const account = await rpc.getAccount(opts.source);
  const contract = new Contract(opts.contractId);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: opts.networkPassphrase,
  })
    .addOperation(contract.call(opts.method, ...opts.args))
    .setTimeout(opts.txTimeoutSeconds)
    .build();
  const sim = await rpc.simulateTransaction(tx);
  if (Api.isSimulationError(sim)) {
    throw new P2pRefusal("simulation_failed", `${opts.method} simulation failed: ${sim.error}`);
  }
  const retval = sim.result?.retval;
  if (!retval) {
    throw new P2pRefusal("simulation_failed", `${opts.method} simulation returned no value`);
  }
  return scValToNative(retval);
}

class SorobanP2pClient implements P2pClient {
  readonly contractId: string;
  private readonly rpc: P2pClientOptions["rpc"];
  private readonly networkPassphrase: string;
  private readonly source: string;
  private readonly txTimeoutSeconds: number;
  private readonly explorerBase: string | undefined;

  constructor(options: P2pClientOptions) {
    this.contractId = options.contractId;
    this.rpc = options.rpc;
    this.networkPassphrase = options.networkPassphrase;
    this.source = options.source;
    this.txTimeoutSeconds = options.txTimeoutSeconds ?? DEFAULT_TX_TIMEOUT_SECONDS;
    this.explorerBase = options.explorerBase;
  }

  private async write(
    functionName: P2pWriteFunction,
    source: string,
    args: xdr.ScVal[],
    title: string,
    context?: string[],
  ): Promise<P2pCall> {
    const unsignedXdr = await buildWrite(this.rpc, {
      contractId: this.contractId,
      method: functionName,
      args,
      source,
      networkPassphrase: this.networkPassphrase,
      txTimeoutSeconds: this.txTimeoutSeconds,
    });
    const { summary, payloadHash } = buildP2pCallSummary({
      unsignedXdr,
      networkPassphrase: this.networkPassphrase,
      contractId: this.contractId,
      functionName,
      title,
      ...(context ? { context } : {}),
      ...(this.explorerBase ? { explorerBase: this.explorerBase } : {}),
    });
    return { unsignedXdr, summary, payloadHash };
  }

  async createOffer(
    seller: string,
    token: string,
    amount: bigint,
    priceTryKurus: bigint,
    ttlSecs: bigint,
  ): Promise<P2pCall> {
    const title = `P2P offer: sell ${fromRawUnits(amount)} for ${kurusToTry(priceTryKurus)} TRY`;
    return this.write(
      "create_offer",
      seller,
      [scAddress(seller), scAddress(token), scI128(amount), scI128(priceTryKurus), scU64(ttlSecs)],
      title,
      [
        `Seller locks ${fromRawUnits(amount)} tokens in escrow`,
        `Asks ${kurusToTry(priceTryKurus)} TRY, paid off-chain by the buyer`,
        `Offer expires in ${ttlSecs} s`,
      ],
    );
  }

  accept(buyer: string, offerId: bigint): Promise<P2pCall> {
    return this.write("accept", buyer, [scAddress(buyer), scU64(offerId)], `P2P accept offer #${offerId}`, [
      `Buyer takes offer #${offerId}`,
      "Pay the TRY off-chain to the seller before the pay deadline",
    ]);
  }

  confirmFiat(seller: string, offerId: bigint): Promise<P2pCall> {
    return this.write(
      "confirm_fiat",
      seller,
      [scAddress(seller), scU64(offerId)],
      `P2P confirm payment received on offer #${offerId}`,
      [
        `Confirm you received the TRY for offer #${offerId}`,
        "This releases the locked tokens to the buyer — confirm only after the TRY arrived",
      ],
    );
  }

  cancel(seller: string, offerId: bigint): Promise<P2pCall> {
    return this.write("cancel", seller, [scAddress(seller), scU64(offerId)], `P2P cancel offer #${offerId}`, [
      `Cancel offer #${offerId} and unlock the tokens`,
    ]);
  }

  reclaim(seller: string, offerId: bigint): Promise<P2pCall> {
    return this.write(
      "reclaim",
      seller,
      [scAddress(seller), scU64(offerId)],
      `P2P reclaim offer #${offerId}`,
      [`The buyer did not pay by the pay deadline; reclaim the locked tokens`],
    );
  }

  async getOffer(offerId: bigint): Promise<Offer | null> {
    const value = await simulateRead(this.rpc, {
      contractId: this.contractId,
      method: "get_offer",
      args: [scU64(offerId)],
      source: this.source,
      networkPassphrase: this.networkPassphrase,
      txTimeoutSeconds: this.txTimeoutSeconds,
    });
    return value === null || value === undefined ? null : decodeOffer(value);
  }

  async nextOfferId(): Promise<bigint> {
    const value = await simulateRead(this.rpc, {
      contractId: this.contractId,
      method: "next_offer_id",
      args: [],
      source: this.source,
      networkPassphrase: this.networkPassphrase,
      txTimeoutSeconds: this.txTimeoutSeconds,
    });
    if (typeof value === "bigint") return value;
    if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
    throw new P2pRefusal("simulation_failed", `next_offer_id returned ${String(value)}`);
  }

  async listOpen(start: bigint, limit: number): Promise<Offer[]> {
    if (!Number.isInteger(limit) || limit < 0) {
      throw new P2pRefusal("invalid_intent", `listOpen limit must be a non-negative integer, got ${limit}`);
    }
    const value = await simulateRead(this.rpc, {
      contractId: this.contractId,
      method: "list_open",
      args: [scU64(start), scU32(limit)],
      source: this.source,
      networkPassphrase: this.networkPassphrase,
      txTimeoutSeconds: this.txTimeoutSeconds,
    });
    return Array.isArray(value) ? value.map(decodeOffer) : [];
  }
}

/** Build a P2P client for one contract id. The id is mandatory and never guessed. */
export function createP2pClient(options: P2pClientOptions): P2pClient {
  if (typeof options.contractId !== "string" || options.contractId.length === 0) {
    throw new P2pRefusal("not_configured", "createP2pClient requires a contractId");
  }
  return new SorobanP2pClient(options);
}
