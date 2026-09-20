// Freighter signing bridge — local fixture server (W4a).
//
// Serves the built bridge page (`app/dist`) and implements the two protocol
// endpoints so the Freighter link can be tried in isolation, before the W4b
// Rust localhost server exists. It builds a real unsigned testnet payment from
// `POLARIS_OWNER_ADDRESS` to the first address in `POLARIS_ALIASES`, hands it to
// the page, verifies whatever signature comes back with the owner's public key,
// prints the verdict and exits.
//
// It NEVER submits the transaction to the network.
//
//   npm run bridge:fixture              # needs POLARIS_OWNER_ADDRESS + POLARIS_ALIASES
//   npm run bridge:fixture -- --selftest  # offline end-to-end smoke test (no Freighter)
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  Account,
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Operation,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const distDir = path.join(repoRoot, "app", "dist");

const FALLBACK_PASSPHRASE = "Test SDF Network ; September 2015";
const FALLBACK_HORIZON = "https://horizon-testnet.stellar.org";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

function fail(message) {
  console.error(`bridge:fixture: ${message}`);
  process.exit(2);
}

/**
 * Parses `POLARIS_ALIASES`. Entries are comma-separated and may be either a
 * bare `G…` address or a `name=G…` pair; the address is what gets used, so the
 * optional alias name is stripped before the address is handed to the SDK.
 */
export function parseAliases(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const separator = entry.indexOf("=");
      return (separator === -1 ? entry : entry.slice(separator + 1)).trim();
    })
    .filter((entry) => entry.length > 0);
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Constant-time token comparison. The token is 192-bit, so its length is not a secret. */
function tokenMatches(provided, expected) {
  if (typeof provided !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** SHA-256 hex of the UTF-8 bytes of a string. */
function sha256Hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Sends a JSON response with the given status. */
function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}

/** Reads one JSON request body, bounded, returning `null` on bad input. */
async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) return null;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

/** Default account loader: fetches the owner account from Horizon, with a timeout. */
async function loadAccountFromHorizon({ owner, horizonUrl }) {
  const server = new Horizon.Server(horizonUrl);
  return withTimeout(server.loadAccount(owner), 4000);
}

/**
 * Reads the sequence off a Horizon `AccountResponse`. On that type
 * `sequenceNumber` is a method, so it must be invoked; anything that is not a
 * numeric string is a bug and throws rather than quietly degrading to the
 * offline placeholder.
 */
function accountSequence(account) {
  const value =
    account && typeof account.sequenceNumber === "function"
      ? account.sequenceNumber()
      : account?.sequenceNumber;
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error(`account sequenceNumber must be a numeric string, got ${typeof value}`);
  }
  return value;
}

/**
 * Builds the unsigned payment. Uses the live Horizon sequence when reachable,
 * otherwise a labelled placeholder so the page can still be exercised offline
 * (the signed result is verified locally and never submitted). The account
 * loader is injectable so the network path can be tested without Horizon.
 */
export async function buildUnsignedPayload({
  owner,
  destination,
  horizonUrl,
  networkPassphrase,
  loadAccount = loadAccountFromHorizon,
}) {
  let sequence = "0";
  let offlineReason = "Horizon was not tried";
  let offline = true;

  if (horizonUrl) {
    let account = null;
    let loadError = null;
    try {
      account = await loadAccount({ owner, horizonUrl });
    } catch (error) {
      loadError = error;
    }
    if (loadError) {
      // Only a genuine load failure (e.g. Horizon unreachable) falls back to
      // the placeholder; a wrong-typed sequence below is not caught here.
      offlineReason = loadError instanceof Error ? loadError.message : String(loadError);
    } else {
      sequence = accountSequence(account);
      offline = false;
    }
  }

  const source = new Account(owner, sequence);
  const transaction = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(Operation.payment({ destination, asset: Asset.native(), amount: "1" }))
    .setTimeout(180)
    .build();

  return {
    offline,
    payload: {
      xdr: transaction.toXDR(),
      networkPassphrase,
      address: owner,
      payloadHash: Buffer.from(transaction.hash()).toString("hex"),
      summary: {
        title: "Sign a testnet payment",
        lines: [
          `From ${owner}`,
          `To ${destination}`,
          "Amount 1 XLM (native)",
          offline
            ? `Offline: ${offlineReason}. Sequence ${sequence} is a placeholder; do not submit this transaction.`
            : `Sequence ${sequence} loaded from Horizon`,
        ],
        estimatedFee: "0.0000100 XLM",
        explorerUrl: `https://stellar.expert/explorer/testnet/account/${owner}`,
      },
    },
  };
}

/**
 * Verifies that `signedXdr` is the *same transaction* as `unsignedXdr` and that
 * it carries a valid signature by the owner. This mirrors the page's verifier
 * (`app/src/bridge/verify.ts`): the signature-base hashes must match, so a wallet
 * that returns a different transaction is rejected even when the source and the
 * operation count are unchanged. Exported so a test can pin the two together.
 */
export function verifySigned({ signedXdr, unsignedXdr, networkPassphrase, owner, payloadHash }) {
  let signed;
  let unsigned;
  try {
    signed = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
  } catch (error) {
    return { verified: false, reason: `signed XDR is malformed: ${error.message}` };
  }
  try {
    unsigned = TransactionBuilder.fromXDR(unsignedXdr, networkPassphrase);
  } catch (error) {
    return { verified: false, reason: `unsigned XDR is malformed: ${error.message}` };
  }
  if (!(signed instanceof Transaction) || !(unsigned instanceof Transaction)) {
    return { verified: false, reason: "fee-bump envelopes are not supported" };
  }

  const signedHash = Buffer.from(signed.hash()).toString("hex");
  const unsignedHash = Buffer.from(unsigned.hash()).toString("hex");
  if (signedHash !== unsignedHash) {
    return {
      verified: false,
      reason: `signed transaction ${signedHash} is not the unsigned transaction ${unsignedHash}`,
    };
  }
  if (payloadHash && payloadHash !== unsignedHash && payloadHash !== sha256Hex(unsignedXdr)) {
    return { verified: false, reason: `payload hash does not match the unsigned transaction` };
  }

  const signer = Keypair.fromPublicKey(owner);
  const matched = signed.signatures.some((signature) => {
    try {
      return signer.verify(signed.hash(), signature.signature);
    } catch {
      return false;
    }
  });
  if (!matched) return { verified: false, reason: `no signature by ${owner}` };
  return { verified: true, hash: signedHash };
}

async function serveStatic(response, pathname) {
  const relative = pathname === "/sign" || pathname === "/sign/" ? "/bridge.html" : pathname;
  const candidate = path.resolve(distDir, `.${relative === "/" ? "/index.html" : relative}`);
  if (candidate !== distDir && !candidate.startsWith(distDir + path.sep)) {
    response.writeHead(403).end("forbidden");
    return;
  }
  try {
    const info = await stat(candidate);
    if (!info.isFile()) throw new Error("not a file");
    const body = await readFile(candidate);
    const type = MIME[path.extname(candidate)] ?? "application/octet-stream";
    response.writeHead(200, { "Content-Type": type }).end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("not found");
  }
}

/**
 * Starts the fixture server. Resolves once it is listening; `resultReady`
 * resolves with the outcome once the page posts a result.
 */
async function startFixtureServer({ owner, destination, horizonUrl, networkPassphrase, loadAccount }) {
  const { payload, offline } = await buildUnsignedPayload({
    owner,
    destination,
    horizonUrl,
    networkPassphrase,
    loadAccount,
  });

  const token = randomBytes(24).toString("hex");
  const session = { consumed: false };
  let resolveResult;
  const resultReady = new Promise((resolve) => {
    resolveResult = resolve;
  });

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const { pathname } = url;

    if (pathname === "/sign/payload" && request.method === "GET") {
      const provided = url.searchParams.get("t");
      if (!tokenMatches(provided, token)) {
        sendJson(response, 403, { error: "unknown token" });
        return;
      }
      if (session.consumed) {
        sendJson(response, 410, { error: "token already used" });
        return;
      }
      sendJson(response, 200, payload);
      return;
    }

    if (pathname === "/sign/result" && request.method === "POST") {
      const provided = url.searchParams.get("t");
      if (!tokenMatches(provided, token)) {
        sendJson(response, 403, { error: "unknown token" });
        return;
      }
      if (session.consumed) {
        sendJson(response, 410, { error: "token already used" });
        return;
      }
      session.consumed = true;
      void (async () => {
        const body = await readJson(request);
        let outcome;
        if (body && body.ok === true && typeof body.signedXdr === "string") {
          const check = verifySigned({
            signedXdr: body.signedXdr,
            unsignedXdr: payload.xdr,
            payloadHash: payload.payloadHash,
            networkPassphrase,
            owner,
          });
          if (check.verified) {
            console.log(`signature valid ✓  (tx hash ${check.hash})`);
            outcome = { verified: true };
          } else {
            console.log(`signature INVALID: ${check.reason}`);
            outcome = { verified: false, reason: check.reason };
          }
        } else if (body && body.ok === false) {
          console.log(`page reported failure: ${body.code} — ${body.error}`);
          outcome = { verified: false, reason: `page reported ${body.code}` };
        } else {
          console.log("page posted a malformed result");
          outcome = { verified: false, reason: "malformed result" };
        }
        response.writeHead(204);
        response.once("finish", () => resolveResult(outcome));
        response.end();
      })();
      return;
    }

    void serveStatic(response, pathname);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  return {
    url: `${base}/sign?t=${token}`,
    base,
    token,
    payload,
    offline,
    resultReady,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function runSelftest() {
  console.log("bridge:fixture: --selftest (offline, no Freighter)");
  const owner = Keypair.random();
  const destination = Keypair.random();
  const networkPassphrase = FALLBACK_PASSPHRASE;

  const server = await startFixtureServer({
    owner: owner.publicKey(),
    destination: destination.publicKey(),
    horizonUrl: null,
    networkPassphrase,
  });

  const pageResponse = await fetch(`${server.base}/sign?t=${server.token}`);
  if (pageResponse.status !== 200) fail(`/sign returned ${pageResponse.status} (run \`npm run build -w @polaris/app\` first)`);
  const pageHtml = await pageResponse.text();
  const assetMatch = pageHtml.match(/src="(\/assets\/[^"]+)"/);
  if (!assetMatch) fail("bridge.html did not reference a built bundle");
  const assetResponse = await fetch(`${server.base}${assetMatch[1]}`);
  if (assetResponse.status !== 200) fail(`bridge asset ${assetMatch[1]} returned ${assetResponse.status}`);

  const payloadResponse = await fetch(`${server.base}/sign/payload?t=${server.token}`);
  if (payloadResponse.status !== 200) fail(`payload endpoint returned ${payloadResponse.status}`);
  const payload = await payloadResponse.json();
  if (payload.address !== owner.publicKey()) fail("payload owner mismatch");

  const resultResponse = await fetch(`${server.base}/sign/result?t=${server.token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: true,
      signedXdr: reencodeSigned(payload.xdr, networkPassphrase, owner),
      signerAddress: owner.publicKey(),
    }),
  });
  if (resultResponse.status !== 204) fail(`result endpoint returned ${resultResponse.status}`);
  const outcome = await server.resultReady;
  if (!outcome.verified) fail(`server did not verify the signature: ${outcome.reason}`);
  await server.close();

  // Negative: a signature by a different key must NOT verify.
  const second = await startFixtureServer({
    owner: owner.publicKey(),
    destination: destination.publicKey(),
    horizonUrl: null,
    networkPassphrase,
  });
  const wrongResult = await fetch(`${second.base}/sign/result?t=${second.token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: true,
      signedXdr: reencodeSigned(payload.xdr, networkPassphrase, Keypair.random()),
      signerAddress: owner.publicKey(),
    }),
  });
  if (wrongResult.status !== 204) fail(`result endpoint returned ${wrongResult.status}`);
  const wrongOutcome = await second.resultReady;
  if (wrongOutcome.verified) fail("a signature by the wrong key verified");
  await second.close();

  console.log("bridge:fixture: selftest passed ✓");
  process.exit(0);
}

/** Re-encodes an envelope with signatures from `signers`. */
function reencodeSigned(xdr, networkPassphrase, ...signers) {
  const transaction = TransactionBuilder.fromXDR(xdr, networkPassphrase);
  transaction.sign(...signers);
  return transaction.toXDR();
}

async function runLive() {
  const owner = process.env.POLARIS_OWNER_ADDRESS?.trim();
  const aliases = parseAliases(process.env.POLARIS_ALIASES);
  if (!owner) fail("POLARIS_OWNER_ADDRESS is required (a testnet G address)");
  if (aliases.length === 0) fail("POLARIS_ALIASES is required (comma-separated testnet G addresses)");
  const destination = aliases[0];
  const networkPassphrase = process.env.STELLAR_NETWORK_PASSPHRASE?.trim() || FALLBACK_PASSPHRASE;
  const horizonUrl = process.env.STELLAR_HORIZON_URL?.trim() || FALLBACK_HORIZON;

  const server = await startFixtureServer({ owner, destination, horizonUrl, networkPassphrase });
  console.log("bridge:fixture: open this URL in your browser:");
  console.log(`  ${server.url}`);
  console.log(
    server.offline
      ? "bridge:fixture: Horizon unreachable — sequence is a placeholder; the signature is still verifiable locally."
      : "bridge:fixture: sequence loaded from Horizon.",
  );
  console.log("bridge:fixture: waiting for the page to post a result…");

  const outcome = await server.resultReady;
  await server.close();
  if (outcome.verified) {
    console.log("bridge:fixture: done — the signed transaction was verified and discarded (never submitted).");
    process.exit(0);
  }
  console.log(`bridge:fixture: done — no valid signature (${outcome.reason}).`);
  process.exit(1);
}

const invokedDirectly =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  if (process.argv.includes("--selftest")) {
    await runSelftest();
  } else {
    await runLive();
  }
}
