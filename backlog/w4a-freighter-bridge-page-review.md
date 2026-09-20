# Review: W4a — Freighter signing bridge page (Stellar Wallets Kit)

- **Date:** 2026-09-20
- **Reviewer:** independent reviewer (read-only), branch `review/w4a-bridge`
- **Under review:** `feat/w4a-freighter-bridge-page` vs `origin/main` (`git diff origin/main...HEAD`)
  — commits `8e3f897`, `6b88759`, `cdd89cc`, `3b8207d`, `d03ae16`
- **Report reviewed:** `backlog/w4a-freighter-bridge-page.md`

## Verdict: REJECT

Two real defects must be fixed before merge. The first is a fail-open on the
value-moving signing path and is explicitly required by the task (the signed XDR
must be the *same transaction*, not merely a valid envelope). The second makes
the `rejected` protocol code unreachable for the real wallet adapter. The rest of
the change is solid, well-tested and narrowly scoped.

---

## Commands run (real output)

No Rust is in the diff (`git diff origin/main...HEAD --name-only | grep -E '\.rs$|src-tauri'`
→ empty), so `cargo test` / `cargo clippy` are not applicable and were not run.

```
$ npm run check
> @polaris/{interfaces,agent,stellar,app} ... tsc -p tsconfig.json
(exit 0, no diagnostics)

$ npm test -w @polaris/app
ℹ tests 36
ℹ pass 36
ℹ fail 0

$ node --test scripts/bridge-fixture.test.mjs
ℹ tests 4
ℹ pass 4
ℹ fail 0

$ npm run build -w @polaris/app
✓ 809 modules transformed.
dist/index.html, dist/bridge.html, dist/assets/{main,bridge}.css,
dist/assets/{utils,classPrivateFieldSet2,sac-spec,client,bridge,main,src,transaction_builder}.js
✓ built
```

Bundle / dependency / leak scans:

- `grep -o -i freighter dist/assets/main-CCBle8n5.js | wc -l` → `0`;
  `.../bridge-BpPJoSMR.js` → `23`. Main entry does not pull Wallets Kit (isolation holds).
- `grep -o "fetch(" bridge-BpPJoSMR.js | wc -l` → `2`, both are the bridge's own
  `/sign/*` calls. `XMLHttpRequest`/`new WebSocket`/`new Image`/`sendBeacon` → `0`.
- Remote URLs present in the bridge chunk: only kit metadata constants
  (`https://stellar.creit.tech/wallet-icons/freighter.png`, `https://freighter.app`,
  `https://stellarwalletskit.dev/`, `https://horizon.stellar.org`). They are not
  fetched by the SDK path this page uses (verified the kit source: the icon/url are
  plain `productIcon`/`productUrl` fields; `StellarWalletsKit.init/fetchAddress/
  signTransaction/getNetwork` make no network request).
- `npm view @creit.tech/stellar-wallets-kit@2.6.0`: official repo
  `github.com/Creit-Tech/Stellar-Wallets-Kit`, maintainer `earrietadev
  <info@earrieta.dev>`, `scripts: {}` on the kit itself, published 2026-08-28.
  No provenance red flag.
- package-lock vs `origin/main`: **+390 packages**, 4 with install scripts
  (`@reown/appkit` postinstall = a local package.json version check, no network;
  `bufferutil`/`secp256k1`/`utf-8-validate` = `node-gyp-build` native builds).
  None of these heavy modules land in the built bundle.

---

## Findings

### BLOCKER 1 — `verifySignedXdr` does not prove the signed XDR is the *same* transaction

`app/src/bridge/verify.ts:50-71`

The verifier accepts any envelope that (a) parses, (b) has the same source
account as the input, (c) has the same **operation count**, and (d) carries a
signature by `payload.address` over **the signed envelope's own hash**. It never
compares operations, sequence, fee, time bounds, memo or hash against the unsigned
payload, and `payloadHash` (`types.ts:32`, `fixtures.ts:53`) is never used by the
page.

Because `signer.verify(signed.hash(), …)` only proves the address signed *some*
transaction, a wallet/extension that returns a different transaction with the same
source and the same number of operations passes verification and is posted as
`{ ok: true }`.

Failure scenario (executed against the real function, not a re-implementation):

```
$ node --input-type=module -e "... import {verifySignedXdr} from './app/src/bridge/verify.ts' ..."
unsigned: dest GDQHU6HC amount 1  seq 123
signed  : dest GC2QR2WX amount 100 seq 999
verifySignedXdr -> {"ok":true}
```

So a reviewed "pay 1 XLM to X" can be swapped for "pay 100 XLM to Y", with a
different sequence/fee, and the bridge reports success. The task explicitly
requires same operations/source/sequence/fee/timebounds. There is no test for a
same-source, same-op-count, different-operation transaction (`verify.test.ts:74`
only covers a **different op count**), which is why this slipped through.

Suggested fix: bind to the input, e.g. require
`Buffer.from(signed.hash()).equals(Buffer.from(unsigned.hash()))` (the hash commits
to source, fee, sequence, timebounds, memo and all operations) and verify the
signature over that hash; alternatively compare against `input.payloadHash`. I
confirmed the honest case satisfies the hash equality, so the check is a clean
drop-in. Add a regression test: same source + 1 op, changed destination/amount/
sequence must be rejected.

### MAJOR 2 — user rejection is misclassified for the real adapter (`rejected` is unreachable)

`app/src/bridge/signFlow.ts:49-52`

```ts
const message = error instanceof Error ? error.message : String(error);
return /reject|declin|denied|cancel|refus/i.test(message);
```

The Wallets Kit does **not** throw `Error`s. `parseError` in
`node_modules/@creit.tech/stellar-wallets-kit/esm/sdk/utils.js:3` returns a plain
object `{ code, message, ext }`, and `FreighterModule.signTransaction` rejects with
exactly that shape. For a plain object `String(error)` is `"[object Object]"`, so
the regex never matches and a real user rejection becomes a generic `error`
instead of `rejected` (wrong status, wrong protocol code posted to W4b).

Executed against the real helper:

```
$ node --input-type=module -e "... import {isUserRejection} ..."
kit-shaped rejection object -> false
Error rejection            -> true
```

`signFlow.test.ts:115` only exercises the `Error` shape, so the test suite does not
catch this. Suggested fix: reuse `messageOf` for the message and test the regex on
that; add a test using `{ code: -1, message: "User declined …" }`.

### MAJOR 3 — fixture verification has the same “valid envelope, not same tx” gap

`scripts/bridge-fixture.mjs:192-211`

`verifySigned` only checks that the envelope parses and carries a signature by
`owner` over its own hash; it does not compare it to the payload at all. The
fixture then prints `signature valid ✓` for any owner-signed transaction. It is a
dev tool, not the product, so this is lower stakes than BLOCKER 1, but it means the
fixture's “verified” verdict does not actually validate the link end-to-end as the
report/docs imply. Fix alongside BLOCKER 1 (reuse the same comparison), or document
the limitation explicitly.

### MINOR 4 — Origin/Host handling is unspecified for W4b

Neither `scripts/bridge-fixture.mjs:251-306` nor `docs/freighter-bridge.md` §2/§6
validates or documents `Origin`/`Host`. The page correctly uses `no-referrer`
(meta + fetch, `bridge.html:9`, `http.ts:43,55`) and cross-origin reads are blocked
because no CORS headers are emitted, but the token-bearing endpoints are reachable
by any local process and (DNS-rebinding aside) the W4b server should reject
requests whose `Origin` is not its own loopback origin. The task explicitly asks
for these assumptions to be captured; add them to the protocol contract and the
threat-model table.

### MINOR 5 — project convention not followed: `backlog.md` / `sprints.md` not updated

The worker’s own ground rules require a row in `backlog.md` and a tick in
`sprints.md`. Neither file is in the diff (report admits it at
`backlog/w4a-freighter-bridge-page.md:62-64,292-294`). The coordinator should add
them before/with the merge. (This review deliberately does not touch them either.)

### MINOR 6 — dependency footprint not recorded

Pulling the kit adds 390 transitive packages (including `@reown/appkit`,
`@walletconnect/sign-client`, `@coinbase/cdp-sdk` + a large Solana subtree,
`@trezor/connect-web`) and 4 install scripts, even though the runtime bundle only
contains the Freighter path. Provenance is clean and the install scripts are
benign (the Reown postinstall only reads package.json), but the project’s security
posture warrants recording the accepted risk in the report/`docs`. Not a code
defect.

### NITs

- `scripts/bridge-fixture.mjs:257,271` — token compared with `!==` (not
  timing-safe) and `session.consumed` is set before the body is validated. Fine for
  a loopback fixture; note it.
- `scripts/bridge-fixture.mjs:299-300` — the `finish` listener is attached
  *after* `response.end()`; safe on Node’s next-tick `finish`, but attaching before
  `end()` would be tidier.
- `app/src/bridge/main.ts:132-145` — `summary.explorerUrl` is set as an anchor
  `href` without scheme validation; a `javascript:` URL from a compromised payload
  would execute on click. Server-controlled today, still worth an allow-list of
  `https:`.
- `app/src/bridge/main.ts:225` — `void runSignFlow(...)`: a throw from
  `onState`/`beforeConnect` becomes an unhandled rejection. Low risk given the
  current callbacks, but a `.catch` would be more honest.
- `app/src/bridge/signFlow.ts:187` — `signerAddress` is hard-set to
  `payload.address`, discarding the wallet-reported signer; consistent with the
  verification, but the wire field is therefore not independent evidence.
- Report evidence accuracy: the pasted build log
  (`backlog/w4a-freighter-bridge-page.md:84-94`) omits four chunks that the real
  build emits (`utils`, `classPrivateFieldSet2`, `sac-spec`, `client`) and the gzip
  column; the chunk hashes that *are* listed match my run, so the isolation claim
  stands, but the log is not the full output.
- No timeout/cancel if the wallet prompt never resolves; the page can sit in
  `awaiting_signature` indefinitely.

---

## Verified as correct

- **Address binding:** `connect()` address is compared to `payload.address` before
  any signing, and a mismatch posts `address_mismatch` and stops
  (`signFlow.ts:126-131`). Tested (`signFlow.test.ts:129`).
- **Network check:** wallet passphrase compared to the payload's and posts
  `network_mismatch` (`signFlow.ts:134-149`); the real adapter implements
  `getNetwork` via the kit (`wallet.ts:48-51`; `FreighterModule.getNetwork` exists).
  Signature hashing is network-specific, so a cross-network signature also fails.
- **Signature must be by `payload.address`:** verification is called with
  `address: payload.address` (`signFlow.ts:174-179`) and checks the signature over
  the envelope hash; wrong-signer test passes (`verify.test.ts:38`).
- **Double-post protection:** a single `posted` guard; a failing POST is caught and
  logged, not retried, and not fatal (`signFlow.ts:82-94`). Tested
  (`signFlow.test.ts:226`).
- **No secret / no XDR leak:** the page holds no secret; only 2 `fetch` calls, both
  same-origin; `credentials: "omit"`, `referrerPolicy: "no-referrer"`, and
  `<meta name="referrer" content="no-referrer">`. No analytics/telemetry and none of
  the heavy kit modules in the bundle.
- **XSS:** `summary.title/lines/estimatedFee`, `networkPassphrase`, `error` and
  debug rows are all inserted as string children via `el()` → text nodes; no
  `innerHTML`/`eval` anywhere in `app/src/bridge`.
- **Bundle isolation:** kit reachable only from `bridge.html`; main chunk has 0
  `freighter` references; `main.ts` and `App.tsx` are untouched.
- **Fixture server:** binds `127.0.0.1` only (`bridge-fixture.mjs:308`); 192-bit
  token (`randomBytes(24)`); POST single-use with `410`; 1 MB body cap
  (`readJson`); path traversal on `app/dist` blocked by resolve+prefix check
  (`serveStatic`); never calls any submit API (only `loadAccount`).
- **Fixture fix (3b8207d):** `accountSequence` invokes the method, rejects
  non-numeric strings, and injects the loader; the regression test genuinely guards
  the bug (asserts `sequence === value + 1`; the old `account.sequenceNumber`
  would throw `sequence must be of type string`). `parseAliases` strips `name=`.
- **Scope:** diff is confined to `app/bridge*`, `app/src/bridge/**`,
  `app/vite.config.ts`, the two `package.json`s, `package-lock.json`,
  `scripts/bridge-fixture*`, `docs/freighter-bridge.md` and the W4a report.
  `App.tsx`, `main.tsx`, `panels/**`, `app/src-tauri/**`, `agent/**`, `stellar/**`,
  `.env.example` are untouched.
- **Tests are real:** fixtures use real keypairs/envelopes; the app suite uses the
  real `verifySignedXdr` on the success path. Removing the source / op-count checks
  would fail `verify.test.ts:50,74`; the fixture regression test fails on the
  pre-fix code.

---

## Required before merge

1. Fix BLOCKER 1 (`verify.ts`) and add the same-source/same-op-count/different
   operation regression test.
2. Fix MAJOR 2 (`isUserRejection`) and add a plain-object rejection test.
3. Address MAJOR 3 in the fixture (or document it as a known dev-tool limitation).
4. Coordinator: add the `backlog.md` row / `sprints.md` tick and record the
   dependency-footprint acceptance (MINOR 5/6); add Origin/Host to the W4b
   contract (MINOR 4).

Real Freighter signing, the rendered UI, and the `npm run dev` bridge entry remain
unverified by automation and still need a human — this review does not change that.
