/**
 * Offline test kit for the P2P client: a scripted fake RPC, deterministic
 * fixtures and XDR decoders. No network, no signing.
 */
import {
  Account,
  Address,
  Networks,
  SorobanDataBuilder,
  StrKey,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  xdr,
  type Operation,
} from "@stellar/stellar-sdk";

import { createP2pClient, DEFAULT_TX_TIMEOUT_SECONDS } from "../client.ts";
import type { Offer, P2pClient, P2pClientOptions, P2pRpcLike } from "../types.ts";

export const SELLER = "GCLBGU2PR36SFHKPSI5WPHD3ZNPZRIXJYQGUVIR6PR4R6R6U3XNNG46E";
export const BUYER = "GB3HO3WGM273M2OZLE5DVRN5WNCNSART6H6SAHP4CXGK34MMGNNDYLX5";
export const OWNER = SELLER;

/** Synthetic contract ids: distinct, valid, and deliberately not the deployed one. */
export const P2P_ID = StrKey.encodeContract(new Uint8Array(32).fill(7));
export const P2P_ID_2 = StrKey.encodeContract(new Uint8Array(32).fill(8));
export const TOKEN_SAC = StrKey.encodeContract(new Uint8Array(32).fill(9));

export type Any = Record<string, unknown>;

/** Scripted stand-in for the two RPC methods the P2P client uses. */
export class FakeP2pRpc {
  sims: Any[] = [];
  simulated: Transaction[] = [];

  async getAccount(address: string): Promise<Account> {
    return new Account(address, "100");
  }

  async simulateTransaction(tx: Transaction): Promise<Any> {
    this.simulated.push(tx);
    const scripted = this.sims.length > 1 ? this.sims.shift() : this.sims[0];
    if (!scripted) throw new Error("FakeP2pRpc: no scripted simulation");
    return scripted;
  }
}

export const okSim = (retval: xdr.ScVal): Any => ({
  _parsed: true,
  id: "1",
  latestLedger: 100,
  events: [],
  transactionData: new SorobanDataBuilder().setResourceFee(5000),
  minResourceFee: "5000",
  result: { auth: [], retval },
});

export const errSim = (error: string): Any => ({ _parsed: true, id: "1", latestLedger: 100, events: [], error });

const scAddress = (address: string): xdr.ScVal => nativeToScVal(address, { type: "address" });
const i128 = (n: bigint): xdr.ScVal => nativeToScVal(n, { type: "i128" });
const u64 = (n: bigint): xdr.ScVal => nativeToScVal(n, { type: "u64" });
const mapEntry = (k: string, v: xdr.ScVal): xdr.ScMapEntry =>
  new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k), val: v });

export const OFFER: Offer = {
  id: 3n,
  seller: SELLER,
  token: TOKEN_SAC,
  amount: 100_0000000n,
  price_try_kurus: 340_000n,
  created_at: 1_789_000_000n,
  expires_at: 1_789_086_400n,
  buyer: null,
  accepted_at: 0n,
  pay_deadline: 0n,
  state: "Open",
};

/** Offer as an ScVal map, as the contract's derived struct spec returns it. */
export function offerScVal(offer: Offer): xdr.ScVal {
  return xdr.ScVal.scvMap([
    mapEntry("accepted_at", u64(offer.accepted_at)),
    mapEntry("amount", i128(offer.amount)),
    mapEntry("buyer", offer.buyer === null ? xdr.ScVal.scvVoid() : scAddress(offer.buyer)),
    mapEntry("created_at", u64(offer.created_at)),
    mapEntry("expires_at", u64(offer.expires_at)),
    mapEntry("id", u64(offer.id)),
    mapEntry("pay_deadline", u64(offer.pay_deadline)),
    mapEntry("price_try_kurus", i128(offer.price_try_kurus)),
    mapEntry("seller", scAddress(offer.seller)),
    mapEntry("state", xdr.ScVal.scvSymbol(offer.state)),
    mapEntry("token", scAddress(offer.token)),
  ]);
}

export function makeClient(rpc: FakeP2pRpc, over: Partial<P2pClientOptions> = {}): P2pClient {
  return createP2pClient({
    contractId: P2P_ID,
    rpc: rpc as unknown as P2pRpcLike,
    networkPassphrase: Networks.TESTNET,
    source: OWNER,
    txTimeoutSeconds: DEFAULT_TX_TIMEOUT_SECONDS,
    ...over,
  });
}

export interface InvokedCall {
  contractId: string;
  name: string;
  args: xdr.ScVal[];
  tx: Transaction;
}

/** Decode the contract invocation carried by a (single-op) built transaction. */
export function invokedCall(unsignedXdr: string): InvokedCall {
  const tx = TransactionBuilder.fromXDR(unsignedXdr, Networks.TESTNET);
  if (!(tx instanceof Transaction)) throw new Error("expected a Transaction");
  const op = tx.operations[0] as Operation.InvokeHostFunction;
  if (op.func.type !== "hostFunctionTypeInvokeContract") throw new Error("not an invoke-contract call");
  return {
    contractId: Address.fromScAddress(op.func.invokeContract.contractAddress).toString(),
    name: op.func.invokeContract.functionName.toString(),
    args: op.func.invokeContract.args,
    tx,
  };
}
