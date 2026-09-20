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
import { randomBytes } from "node:crypto";
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

function parseAliases(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function withTimeout(promise, ms) {  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
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

/**
 * Builds the unsigned payment. Uses the live Horizon sequence when reachable,
 * otherwise a labelled placeholder so the page can still be exercised offline
 * (the signed result is verified locally and never submitted).
 */
async function buildUnsignedPayload({ owner, destination, horizonUrl, networkPassphrase }) {
  let sequence = "0";
  let offlineReason = "Horizon was not tried";
  let offline = true;

  if (horizonUrl) {
    try {
      const server = new Horizon.Server(horizonUrl);
      const account = await withTimeout(server.loadAccount(owner), 4000);
      sequence = account.sequenceNumber;
      offline = false;
    } catch (error) {
      offlineReason = error instanceof Error ? error.message : String(error);
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

/** Verifies that `signedXdr` carries a valid signature by the owner. */
function verifySigned({ signedXdr, networkPassphrase, owner }) {
  let transaction;
  try {
    transaction = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
  } catch (error) {
    return { verified: false, reason: `signed XDR is malformed: ${error.message}` };
  }
  const signer = Keypair.fromPublicKey(owner);
  const hash = transaction.hash();
  const matched = transaction.signatures.some((signature) => {
    try {
      return signer.verify(hash, signature.signature);
    } catch {
      return false;
    }
  });
  if (!matched) return { verified: false, reason: `no signature by ${owner}` };
  return { verified: true, hash: Buffer.from(hash).toString("hex") };
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
async function startFixtureServer({ owner, destination, horizonUrl, networkPassphrase }) {
  const { payload, offline } = await buildUnsignedPayload({
    owner,
    destination,
    horizonUrl,
    networkPassphrase,
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
      if (provided !== token) {
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
      if (provided !== token) {
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
          const check = verifySigned({ signedXdr: body.signedXdr, networkPassphrase, owner });
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
        response.writeHead(204).end();
        response.once("finish", () => resolveResult(outcome));
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

if (process.argv.includes("--selftest")) {
  await runSelftest();
} else {
  await runLive();
}
