# Freighter signing bridge (W4a)

The Polaris desktop app runs in a Tauri webview and cannot talk to the user's
Freighter browser extension. To sign with Freighter, the app opens a small web
page in the user's **normal browser** on a loopback address; that page asks
Freighter to sign exactly one XDR and posts the result back. The app never holds
a secret key.

This document is the contract between the page (built in W4a, this change) and
the Rust localhost server that serves it (W4b).

---

## 1. Architecture

```
┌────────────────────────┐   opens in default browser   ┌──────────────────────┐
│  Polaris (Tauri shell) │ ───────────────────────────▶ │  /sign?t=<token>     │
│  localhost server W4b  │                              │  bridge page (W4a)   │
│  • one-time token      │   GET  /sign/payload?t=…     │  • Stellar Wallets   │
│  • Touch ID gate       │ ◀──────────────────────────  │    Kit (Freighter)   │
│  • holds no secret     │   POST /sign/result?t=…      │  • verifies the XDR  │
└────────────────────────┘ ◀──────────────────────────  └──────────────────────┘
                                     │
                                     ▼
                          user's Freighter extension
                          (owns the secret key)
```

The bridge entry is a second Vite/Rollup input (`app/bridge.html` →
`app/src/bridge/**`). The desktop app's entry (`index.html`) never imports
Wallets Kit, so its bundle size is unchanged; the kit lands only in the bridge
chunk that W4b serves.

---

## 2. Protocol (do not deviate)

The page is opened at `http://127.0.0.1:<port>/sign?t=<token>` (optional
`&debug=1`). It talks only to that same origin.

### `GET /sign/payload?t=<token>`

`200`:

```jsonc
{
  "xdr": "…",                     // base64 unsigned transaction envelope
  "networkPassphrase": "Test SDF Network ; September 2015",
  "address": "G…",                // the G address that must sign
  "payloadHash": "…",             // optional hex digest of the unsigned XDR (see below)
  "summary": {
    "title": "Sign a testnet payment",
    "lines": ["From G…", "To G…", "Amount 1 XLM"],
    "estimatedFee": "0.0000100 XLM",
    "explorerUrl": "https://…"    // optional
  }
}
```

`403` / `404` / `410` with `{ "error": "…" }` when the token is unknown,
consumed, or expired. The page treats `410` as the `expired` state and **posts
nothing** (there is no valid token to answer to).

`payloadHash` is an **optional** consistency token, not the security binding
(that is the signed-vs-unsigned hash equality in §3). When the payload carries
one, the page requires it to be a hex digest of the unsigned XDR: either the
transaction signature-base hash (`tx.hash()`, what the approval flow emits today)
or the SHA-256 of the UTF-8 bytes of the base64 XDR string. A payload that omits
it is accepted; a payload that carries a different value is rejected.

### `POST /sign/result?t=<token>`

```jsonc
{ "ok": true,  "signedXdr": "…", "signerAddress": "G…" }
{ "ok": false, "code": "rejected" | "address_mismatch" | "network_mismatch" | "wallet_unavailable" | "error", "error": "…" }
```

`204` on success. The token is one-time: it is consumed by the first accepted
result.

The page never receives or sends anything else. It must not put the token in any
outbound third-party request; the bridge page sends `Referrer-Policy:
no-referrer` (both a `<meta name="referrer">` tag and `referrerPolicy` on every
`fetch`).

---

## 3. The state machine

`app/src/bridge/signFlow.ts` is pure and takes injected `wallet` and `http`
interfaces, so every failure path is unit-tested without a browser or a wallet.

```
loading ─▶ connecting ─▶ awaiting_signature ─▶ signed
              │                  │
              │                  ├─ rejected          (user said no)
              ├─ error            ├─ error             (bad/malformed/other)
              ├─ expired         └─ error             (address/network mismatch)
```

Rules, in order:

1. Fetch the payload.
2. Ask the wallet to connect and return its address.
3. **The address must equal `payload.address`**, otherwise post
   `address_mismatch` and stop. Wallets let the user switch accounts; a signature
   from the wrong account is useless for this transaction and could be a UI
   confusion, so the bridge fails closed.
4. Confirm the wallet's network passphrase equals the payload's, otherwise post
   `network_mismatch`.
5. `signTransaction(xdr, { networkPassphrase, address })`.
6. On a user rejection (message matches `reject|declin|denied|cancel|refus`),
   post `rejected`. On any other error, post `error`.
7. Verify the returned envelope (`app/src/bridge/verify.ts`): it must parse, have
   the same source account and operation count as the input, and — crucially —
   have the **same signature-base hash** as the unsigned input. The hash commits
   to source, fee, sequence, time bounds, memo and every operation, so a wallet
   that returns a *different* transaction is rejected even with the same source
   and operation count. The `payloadHash`, when present, must match the unsigned
   XDR as well. Finally the signature must be by `payload.address` over that
   hash. Fee-bump envelopes are refused. Only then post `{ ok: true }`.

The result is posted **at most once**, even if the POST itself fails.

---

## 4. Threat model

| Concern | Mitigation |
|---|---|
| Another local process reads the token | Token is one-time and short-lived (W4b expiry); it is only in the URL the app opens. |
| A non-loopback origin (e.g. DNS rebinding) drives the bridge | W4b rejects any request whose `Host`/`Origin` is not its own loopback origin (see §6). |
| Token leaks via `Referer` to a third party | `no-referrer` on the document and on every `fetch`; nothing third-party is loaded. |
| Any page can claim an address | Signatures are verified against the expected address before the result is accepted. |
| Wrong-account signature | `address` is compared before signing; `address_mismatch` otherwise. |
| Wrong-network signature | `network_mismatch` + signature verification recomputes the network hash. |
| Value-moving without consent | The page **only signs**; the Touch ID approval gate lives upstream in the shell (W4b/W3). The bridge never submits a transaction. |
| Secrets in the page | The page holds no secret. Freighter holds the key; the app only ever sees the public address and a signed XDR. |

The bridge is **localhost only**: the W4b server binds `127.0.0.1`, and the page
refuses to be a general-purpose signer because the payload comes from the app.

---

## 5. Running the fixture (test the Freighter link now)

`scripts/bridge-fixture.mjs` is an offline-capable dev server that serves the
built bridge and implements both endpoints, so the link can be tried before W4b
exists. It **never submits** the transaction.

```bash
# Build the bridge first (also emits the rest of app/dist).
npm run build -w @polaris/app

# Provide two PUBLIC testnet addresses. It refuses to start without them.
POLARIS_OWNER_ADDRESS=G… npm run bridge:fixture        # POLARIS_ALIASES from .env
# or, with the gitignored root .env:
POLARIS_ALIASES=G…,G… npm run bridge:fixture
```

- `POLARIS_OWNER_ADDRESS` — the testnet G address that will sign (must have the
  Freighter account selected to Testnet).
- `POLARIS_ALIASES` — comma-separated entries; each is a bare `G…` address or a
  `name=G…` pair (the name is stripped). The **first** is the recipient.
- `STELLAR_HORIZON_URL` / `STELLAR_NETWORK_PASSPHRASE` are optional; defaults are
  testnet.

It prints a URL like `http://127.0.0.1:52345/sign?t=…`. Open it in your normal
browser, approve in Freighter, and the fixture prints `signature valid ✓` (or why
not) and exits.

If Horizon is unreachable it still works: the sequence becomes a clearly-labelled
placeholder, signing and local verification still pass, and the transaction is
simply not submittable.

### Offline end-to-end smoke test

```bash
npm run bridge:fixture -- --selftest
```

Generates an ephemeral keypair, serves the page, fetches the payload, signs it in
process, posts it, and asserts the server verifies it — then repeats with a
wrong-key signature and asserts it is rejected. No Freighter, no network.

---

## 6. How W4b will serve it

W4b adds a Rust localhost server that:

1. binds `127.0.0.1` on an ephemeral port and mints a one-time, expiring token;
2. serves the built bridge assets from the Tauri asset resolver (embedded
   `app/dist`) at `/sign*`, mapping `/sign` to `bridge.html`;
3. implements `GET /sign/payload` and `POST /sign/result` exactly as above,
   consulting the token store and the Touch ID approval gate before accepting a
   result;
4. opens the URL in the user's default browser and waits for the result.

### Requirements for the Rust server (W4b)

The page assumes a hardened loopback-only endpoint. W4b must enforce all of the
following, and the review of W4b must check them explicitly:

- **Host:** the `Host` header must equal `127.0.0.1:<port>`.
- **Origin:** the `Origin` header must be absent or exactly
  `http://127.0.0.1:<port>`; any other origin is rejected.
- **Content-Type:** `POST /sign/result` must carry
  `Content-Type: application/json`; anything else is rejected.
- **Body cap:** reject request bodies larger than 64 KiB.
- **Response headers:** every response carries `Cache-Control: no-store` and
  `Referrer-Policy: no-referrer`.
- **CSP:** a restrictive `Content-Security-Policy` for the served page
  (`default-src 'none'`, with only the bundled `script-src`/`style-src` allowed).
- **Method allow-list:** only `GET /sign/payload`, `POST /sign/result` and static
  `GET` are served; everything else is `404`/`405`.
- **Token:** compare with a constant-time comparison, accept each token exactly
  once, and expire it (TTL). Unknown/expired tokens answer `403`/`410`.
- **CORS:** never emit `Access-Control-Allow-Origin` (or any other CORS header),
  so cross-origin reads stay impossible.

The page and the W4b server must stay in lockstep; change one, change the other.

---

## 6b. Implementation notes (W4b-1)

The Rust half lives in `app/src-tauri/src/bridge/`:

- `mod.rs` — module overview and the three exported commands.
- `server.rs` — the one-shot `tiny_http` session, the payload/result endpoints,
  the static asset provider and `bridge_health`.
- `verify.rs` — parse-free XDR verification and the transaction hash.
- `strkey.rs` — `G...` StrKey decoding (base32 + version byte + CRC16-XModem).
- `launch.rs` — macOS `open` (no shell) and `POLARIS_BRIDGE_BROWSER`.
- `commands.rs` — `bridge_sign`, `bridge_selftest`, `bridge_health`.

**Server.** `SigningSession::start` binds `127.0.0.1:0`, mints a 32-byte token
from the OS CSPRNG, and serves on one blocking thread. Every request is checked
against the session's own origin: `Host` must equal `127.0.0.1:<port>` and
`Origin` must be absent or that same origin (DNS-rebinding guard). Only
`GET /sign/payload`, `POST /sign/result` and static `GET` are served; anything
else is `404`. `POST` requires `Content-Type: application/json`, a body at most
64 KiB, and the token compared in constant time. The first accepted result wins
and a second post is `410` even after the waiter has read the outcome. Every
response carries `Cache-Control: no-store` and `Referrer-Policy: no-referrer`;
static responses also carry the restrictive CSP. No CORS header is ever emitted.

**Browser.** macOS `open` is used directly with the URL as a single argument.
`POLARIS_BRIDGE_BROWSER` (an application name such as `Google Chrome`, validated
against a conservative charset) selects `open -a "<name>" <url>`; leave it unset
for the default browser. Freighter must be installed in whichever browser opens.

**Verification.** Rust never trusts the page's own checks. A v1
`TransactionEnvelope` with an empty signature list is
`[00000002][Transaction body…][00000000]`, so the body is a byte slice and the
source key / fee / sequence sit at fixed offsets. The transaction hash is
`SHA-256(SHA-256(networkPassphrase) || 00000002 || body)` — pinned to the JS SDK
by a test vector — and a signed envelope must equal
`unsigned[..len-4] || 00000001 || hint(4) || 00000040 || signature(64)` with the
same body bytes, signed by the owner's key. Any deviation is `integrity`.

**Self-test safety.** `bridge_selftest` bypasses the approval gate, so it refuses
any envelope whose source is not the configured owner **and** any envelope whose
sequence number is not exactly `0`. A sequence-0 transaction can never be applied
on-chain, so the self-test cannot be used to sign a real transaction.

**Dev build.** The static assets come from the Tauri asset resolver (embedded
`app/dist`). When the resolver has no file (a dev build that did not bundle the
frontend), the server falls back to `app/dist` on disk; when that is absent too,
it answers `404` with the message to run `npm run build -w @polaris/app`.

**Not verified by the automated checks** (needs a human): opening a real browser
and completing a real Freighter round trip.

## 7. Known limits

- **Real Freighter signing is not verified by W4a's automated checks.** That
  needs Freighter installed, unlocked, on Testnet, with the matching account, in
  the user's normal browser. Run `npm run bridge:fixture` to check it by hand.
- Only Freighter is enabled. Other Wallets Kit modules are deliberately not
  shipped (smaller surface and bundle).
- The fixture is a dev tool, not the product: no expiry beyond one-time use, no
  Touch ID. W4b adds both.
- The desktop Debug panel cannot exercise this feature from the Tauri webview
  (no extension access). Its live check belongs to W4b as a server-side health
  command; W4a produces no `FeatureCheck` because the required location
  (`app/src/debug/checks/`) is outside this task's file scope.

## 8. Files

- `app/bridge.html` — the page shell.
- `app/src/bridge/types.ts` — wire types.
- `app/src/bridge/signFlow.ts` — the pure state machine.
- `app/src/bridge/verify.ts` — signed-envelope verification.
- `app/src/bridge/http.ts` — same-origin endpoint client.
- `app/src/bridge/wallet.ts` — Stellar Wallets Kit (Freighter) adapter.
- `app/src/bridge/main.ts`, `app/src/bridge/bridge.css` — the UI.
- `app/src/bridge/*.test.ts` — unit tests.
- `scripts/bridge-fixture.mjs` — the fixture server.
