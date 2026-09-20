// W1 acceptance driver — a real unsigned testnet XDR, built headless.
//
//   POLARIS_OWNER_ADDRESS=G... POLARIS_ALIASES=acc2=G... npm run e2e:build-xdr -- 1
//
// It exercises the exact chain-lane path the shell uses, with no voice and no
// signing: the owner account is loaded READ-ONLY from testnet Horizon, an
// unsigned native-XLM payment XDR is built for the given amount to `acc2`, and
// the decoded summary, the XDR digest and the Stellar transaction hash are
// printed (labelled, because they are different values). It never signs, never
// submits, and never reads a secret (the owner is a public address).
import { readFileSync } from "node:fs";

import { xdrDigest } from "../agent/src/execution.ts";
import { TESTNET_HORIZON_URL, TESTNET_PASSPHRASE } from "../stellar/src/anchor/config.ts";
import {
  createSendPayment,
  defaultPaymentDeps,
  parseAliasBook,
  payloadHashOf,
} from "../stellar/src/payments/index.ts";

const amount = (process.argv[2] ?? "1").trim();
const recipient = (process.argv[3] ?? "acc2").trim();

const ownerAddress = (process.env.POLARIS_OWNER_ADDRESS ?? "").trim();
if (!ownerAddress) {
  console.error("set POLARIS_OWNER_ADDRESS to the public G... testnet sender address");
  process.exit(2);
}

// Env aliases (alias=G...,...) merged over the committed book, env winning.
const envAliases = {};
for (const pair of (process.env.POLARIS_ALIASES ?? "").split(",")) {
  const trimmed = pair.trim();
  if (!trimmed) continue;
  const eq = trimmed.indexOf("=");
  if (eq <= 0) continue;
  envAliases[trimmed.slice(0, eq).trim()] = {
    address: trimmed.slice(eq + 1).trim(),
    network: "testnet",
  };
}
const committed = JSON.parse(
  readFileSync(new URL("../stellar/config/aliases.json", import.meta.url), "utf8"),
);
const { book, warnings } = parseAliasBook({ ...committed, ...envAliases });
for (const warning of warnings) console.warn(`alias warning: ${warning}`);
if (!book[recipient]) {
  console.error(`alias "${recipient}" is not in the book (committed aliases.json + POLARIS_ALIASES)`);
  process.exit(2);
}

const tool = createSendPayment(defaultPaymentDeps({ ownerAddress, aliases: book }));
console.log(`owner: ${ownerAddress}`);
console.log(`intent: send ${amount} XLM to ${recipient} (${book[recipient].address})`);
console.log(`horizon (read-only): ${TESTNET_HORIZON_URL}`);

const result = await tool({ kind: "send", asset: "XLM", amount, recipient });

console.log("summary:");
console.log(JSON.stringify(result.summary, null, 2));
// Two different values, labelled so they cannot be confused:
//  - xdrDigest: SHA-256 of the base64 XDR string; the approval gate's `payloadHash`.
//  - txHash:    the Stellar transaction hash (Transaction.hash()); explorer id.
console.log(`xdrDigest: ${xdrDigest(result.unsignedXdr)}`);
console.log(`txHash: ${payloadHashOf(result.unsignedXdr, TESTNET_PASSPHRASE)}`);
console.log(`unsignedXdr: ${result.unsignedXdr}`);
console.log("nothing was signed or submitted");
