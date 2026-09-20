// W8b acceptance driver — a real read of the deployed `polaris_p2p_escrow`.
//
//   POLARIS_P2P_CONTRACT_ID=C... npm run p2p:live
//   npm run p2p:live -- --id C... [--source G...]
//
// Simulation-only: `next_offer_id`, `list_open`, then `get_offer` for the ids
// in [1, next). Nothing is signed or submitted and no secret is read. The
// source is a public testnet account used only to build the simulation
// transaction (reads are not authorised).
import { rpc } from "@stellar/stellar-sdk";

import { createP2pClient } from "../stellar/src/p2p/index.ts";

const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
const RPC_URL = process.env.POLARIS_RPC_URL ?? "https://soroban-testnet.stellar.org";
// Public read-only testnet account (the W8a escrow deployer).
const DEFAULT_SOURCE = "GAXZBZ3TOUBORMH2NNRC3LNNCVIQMDNQV7K4HHUAKOEE3AIJMHGGD57P";
const MAX_INSPECT = 10n;

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? (process.argv[index + 1] ?? "").trim() : "";
}

const contractId = (argValue("--id") || process.env.POLARIS_P2P_CONTRACT_ID || "").trim();
if (!contractId) {
  console.error("set POLARIS_P2P_CONTRACT_ID or pass --id <contract id>");
  process.exit(2);
}
const source = (argValue("--source") || process.env.POLARIS_OWNER_ADDRESS || DEFAULT_SOURCE).trim();

const client = createP2pClient({
  contractId,
  rpc: new rpc.Server(RPC_URL, { allowHttp: RPC_URL.startsWith("http://") }),
  networkPassphrase: NETWORK_PASSPHRASE,
  source,
});

const json = (value) =>
  JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item));

console.log(`contract: ${contractId}`);
console.log(`rpc (read-only): ${RPC_URL}`);
console.log(`source: ${source}`);

const next = await client.nextOfferId();
console.log(`next_offer_id: ${next}`);

const open = await client.listOpen(1n, 20);
console.log(`list_open(1, 20): ${open.length} open offer(s)`);
for (const offer of open) console.log(json(offer));

// Walk the ids below the counter so `get_offer` proves the enum/Option decode
// for every existing offer, not only the currently open ones.
let decoded = 0n;
for (let id = 1n; id < next && id <= MAX_INSPECT; id++) {
  const offer = await client.getOffer(id);
  if (offer === null) {
    console.log(`get_offer(${id}): none`);
    continue;
  }
  decoded += 1n;
  console.log(`get_offer(${id}): ${json(offer)}`);
}
if (next > MAX_INSPECT + 1n) {
  console.log(`(only ids 1..${MAX_INSPECT} inspected; ${next - MAX_INSPECT - 1n} more exist)`);
}
console.log(`done: ${decoded} offer(s) decoded; nothing was signed or submitted`);
