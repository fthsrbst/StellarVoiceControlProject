# Report: W4a — Freighter signing bridge page (Stellar Wallets Kit)

- **Date:** 2026-09-20
- **Worker/Agent:** opencode worker (deepseek-v4.1-flash)
- **Branch/Worktree:** `feat/w4a-freighter-bridge-page` / `.worktrees/w4a-bridge-page`
- **PR:** none (task: leave changes uncommitted; coordinator commits after verifying)

## Objective

Build the browser-side half of the Freighter bridge: a second Vite entry
(`app/bridge.html`) that signs one specific XDR through Stellar Wallets Kit
(Freighter only) and posts the signed result back to the W4b localhost server.
Includes the pure state machine, the UI, a local fixture server to try the link
today, unit tests, and docs. No secrets, localhost only, fail-closed address and
network checks.

## What was done

1. **Second Vite entry.** `app/bridge.html` + `app/src/bridge/**`, wired as an
   extra `rollupOptions.input` in `app/vite.config.ts`. `npm run build -w
   @polaris/app` now emits `dist/bridge.html` alongside `dist/index.html`.
2. **Dependency.** `@creit.tech/stellar-wallets-kit` pinned to the exact
   `2.6.0` in `app/package.json`; root `package-lock.json` updated. API taken
   from the installed package's own types/README (`StellarWalletsKit.init`,
   `setNetwork`, `fetchAddress`, `signTransaction`; `FreighterModule` +
   `FREIGHTER_ID` from the `modules/freighter` subpath) — not from memory.
3. **`signFlow`.** Pure state machine with injected `wallet`/`http`:
   `loading → connecting → awaiting_signature → signed | rejected | error |
   expired`. Address must equal `payload.address` (else `address_mismatch`,
   stop); network passphrase compared (else `network_mismatch`); the signed
   envelope is verified with `@stellar/stellar-sdk`
   (`TransactionBuilder.fromXDR`, same source + operation count, signature by
   `payload.address` over the recomputed transaction hash). The result is posted
   at most once.
4. **UI.** Tiny plain-DOM card (`app/src/bridge/main.ts` + `bridge.css`), dark
   Polaris tokens, read-only summary shown before the wallet prompt (a "Sign with
   Freighter" button gates `beforeConnect`), a 4-step indicator, clear
   success/error states with the posted `code`, and a protocol log under
   `debug=1` (no token, no full XDR).
5. **Fixture server.** `scripts/bridge-fixture.mjs` + root `bridge:fixture`
   script. Node `http`, binds `127.0.0.1` on a random port, one-time token,
   serves `app/dist`, implements both endpoints, verifies the returned signature
   with the owner's public key and exits. Never submits. Refuses to start without
   `POLARIS_OWNER_ADDRESS` + `POLARIS_ALIASES`. `--selftest` runs an offline
   end-to-end check without Freighter.
6. **Docs.** `docs/freighter-bridge.md` — architecture, protocol, threat model,
   fixture usage, W4b plan, known limits.

### Decisions

- **Freighter only.** No `defaultModules()`; importing one module keeps the
  surface and bundle small. The subpath import is the only Wallets Kit import
  site (`wallet.ts`).
- **Flat state snapshot** (`{ status, ... }`) instead of a discriminated union —
  the UI switches on `status`, and tests assert status + posted code.
- **`beforeConnect` gate** added to `signFlow` so the summary is readable before
  Freighter opens, without adding a non-protocol state.
- **`410` → `expired`, nothing posted**; `403/404` → generic `error`, nothing
  posted (an invalid token has nothing to answer to).
- **Rejection heuristic** matches `/reject|declin|denied|cancel|refus/i` across
  wallet error shapes; everything else is `error`.
- I did **not** edit `backlog.md`/`sprints.md`: this task's scope explicitly
  forbids editing them, so the coordinator should add the index row/checklist
  item.

## Real output

```
$ npm run check                      # exit 0 — interfaces, agent, stellar, app all clean

$ npm test -w @polaris/app           # exit 0
ℹ tests 36
ℹ pass 36
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```
(17 new bridge tests: success, rejection, address mismatch, network mismatch,
wallet unavailable, expired 410, malformed XDR, wrong signer, single-post, plus
verify/types fixtures. App total 19 → 36.)

```
$ npm run build -w @polaris/app      # exit 0
dist/index.html                                  0.52 kB
dist/bridge.html                                 0.83 kB
dist/assets/bridge-B0UOhKdb.css                  2.76 kB
dist/assets/main-BkWtUz4C.css                   16.54 kB
dist/assets/bridge-BpPJoSMR.js                 121.20 kB │ gzip: 41.18 kB
dist/assets/main-CCBle8n5.js                   248.46 kB │ gzip: 78.91 kB
dist/assets/src-C2E-xoga.js                    278.51 kB
dist/assets/transaction_builder-CSYCpxne.js    302.11 kB
✓ built in 776ms
```

Bundle isolation proof (fresh `dist`):

```
freighter count in main chunk:   0
freighter count in bridge chunk: 23
index.html  scripts: main-CCBle8n5.js (+ shared chunk)
bridge.html scripts: bridge-BpPJoSMR.js (+ shared chunks)
```

The main app entry does not gain Wallets Kit; only `bridge.html` loads it.

```
$ npm run bridge:fixture -- --selftest   # exit 0 (offline, no Freighter)
bridge:fixture: --selftest (offline, no Freighter)
signature valid ✓  (tx hash 6e29c268e02aa3f36bf66b24c759b4c0ec9dc7b426def8c85a916f60fcbe7dd7)
signature INVALID: no signature by GCGEFZBNUBFS2VTP6BIPW5IQ2SURN43POECCCDDDDY44LULHE6YBUF5V
bridge:fixture: selftest passed ✓
```

Full live-mode path driven by an in-process fake browser client (ephemeral
keypairs, no Freighter), proving both endpoints + real signature verification:

```
bridge:fixture: open this URL in your browser:
  http://127.0.0.1:52196/sign?t=bba817fbba6874ad68a243ec24d55b049a67ea10089b37c1
bridge:fixture: Horizon unreachable — sequence is a placeholder; the signature is still verifiable locally.
bridge:fixture: waiting for the page to post a result…
payload.address === owner: true
signature valid ✓  (tx hash 8ad4b2699139dbe953abb46759f0b16433b8b1780ec21e6346c80986835a5c3f)
POST /sign/result status: 204
bridge:fixture: done — the signed transaction was verified and discarded (never submitted).
fixture exit code: 0
```

Refusal without config:

```
$ node scripts/bridge-fixture.mjs        # (POLARIS_OWNER_ADDRESS unset)
bridge:fixture: POLARIS_OWNER_ADDRESS is required (a testnet G address)
EXIT=2
```

## Files changed

- **New:** `app/bridge.html`, `app/src/bridge/{types,signFlow,verify,http,wallet,main}.ts`,
  `app/src/bridge/{fixtures,signFlow.test,verify.test,types.test}.ts`,
  `app/src/bridge/bridge.css`, `scripts/bridge-fixture.mjs`,
  `docs/freighter-bridge.md`, `backlog/w4a-freighter-bridge-page.md`
- **Modified:** `app/vite.config.ts` (second input), `app/package.json` (exact
  `@creit.tech/stellar-wallets-kit@2.6.0`), `package.json` (one `bridge:fixture`
  script), `package-lock.json`
- **Not touched:** `app/src/App.tsx`, `app/src/main.tsx`, `app/src/panels/**`,
  `app/src-tauri/**`, `agent/**`, `stellar/**`, `sprints.md`, `backlog.md`,
  `.env.example`

## Remaining work / handoff

- **W4b** must implement the same two endpoints (one-time expiring token, Touch
  ID gate) and serve `app/dist` (map `/sign` → `bridge.html`). Keep the protocol
  in `docs/freighter-bridge.md` §2 as the single source of truth.
- **`POLARIS_OWNER_ADDRESS` / `POLARIS_ALIASES` are not in `.env.example`** (out
  of this task's scope). They are public testnet addresses and should be added by
  whoever owns `.env.example`.
- **Debug panel FeatureCheck:** W4a produces none. The required location
  (`app/src/debug/checks/`) is outside this task's file scope, and the Tauri
  webview cannot reach Freighter anyway — the live check is naturally a W4b
  server-side `<feature>_health` command.
- **Test placement:** the offline fixture selftest lives in the fixture script
  (`--selftest`) rather than `npm test`, because the unit suite is required to be
  network-free and adding `scripts/*-e2e.mjs` was outside the touch scope.

## Unverified (stated plainly)

- **Real Freighter signing is not verified.** Needs Freighter installed,
  unlocked, on Testnet, with the matching account, in a normal browser. A human
  must run `npm run bridge:fixture` (with the two public env addresses) and
  approve in Freighter.
- **The rendered UI was not observed in a browser.** It typechecks, builds, and
  the logic is unit-tested, but no human/browser saw the card.
- **`app/vite.config.ts` multi-page output is verified only for the production
  build**; `npm run dev` for the bridge entry was not exercised (W4b serves the
  built page).
- Horizon was unreachable in this environment, so the live path was exercised
  through the labelled dummy-sequence fallback; the online sequence load was not
  observed.

---

## Fix — W4a-fix: live Horizon path crashed (`sequence must be of type string`)

- **Date:** 2026-09-20
- **Worker/Agent:** opencode worker (deepseek-v4.1-flash)
- **Branch/Worktree:** `feat/w4a-freighter-bridge-page` / `.worktrees/w4a-bridge-page`

### Root cause

`buildUnsignedPayload` did `sequence = account.sequenceNumber;`. On a Horizon
`AccountResponse` (`node_modules/@stellar/stellar-sdk/lib/esm/horizon/account_response.d.ts:57`)
`sequenceNumber()` is a **method**, so a function was passed to `new Account(...)`,
which threw `sequence must be of type string`. The offline placeholder path never
touched it, so `--selftest` stayed green.

### What changed (`scripts/bridge-fixture.mjs` only)

1. **Method is invoked; bad types are loud.** New `accountSequence(account)`
   calls `sequenceNumber()` when it is a function, then requires a numeric
   string. The tracker/loader call is wrapped in its own `try/catch`, so **only a
   genuine load failure** becomes the labelled offline placeholder; a returned
   account with a wrong-typed sequence throws instead of silently degrading.
2. **Injectable loader.** `buildUnsignedPayload({ …, loadAccount })` defaults to
   `loadAccountFromHorizon({ owner, horizonUrl })` (the old 4 s-timeout Horizon
   call) and is exported; `startFixtureServer` threads it through.
3. **Top-level run guarded** (`path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)`)
   so the module can be imported by a test without starting a server.
4. **Alias parsing (found while running the task's live command).** The supplied
   value `POLARIS_ALIASES=acc2=GB25…` made `Operation.payment` throw
   `destination is invalid`, because `parseAliases` kept the `name=` prefix.
   `parseAliases` now strips an optional `name=` from each comma-separated entry
   (bare `G…` addresses still work).

### Regression test — `scripts/bridge-fixture.test.mjs` (new)

Three cases required by the task, plus one for aliases: the method-based
`AccountResponse` produces a transaction sequence of `value + 1` with
`offline === false`; a rejecting loader yields the labelled placeholder; a
wrong-typed sequence rejects with `sequenceNumber must be a numeric string`
(never the placeholder); `parseAliases` strips `name=`. Reverting the fix to the
old `sequence = account.sequenceNumber` was run once and makes the suite fail
with the original `sequence must be of type string` — so the test is a real
regression guard.

### Real output

```
$ node --test scripts/bridge-fixture.test.mjs        # exit 0
✔ loads the live sequence from a method-based Horizon account
✔ falls back to the labelled offline placeholder when the loader rejects
✔ a wrong-typed sequence is an error, never a silent offline fallback
✔ parses bare and name-prefixed alias entries down to addresses
ℹ tests 4
ℹ pass 4
ℹ fail 0

$ npm test -w @polaris/app                            # exit 0 (unchanged)
ℹ tests 36
ℹ pass 36
ℹ fail 0

$ node scripts/bridge-fixture.mjs --selftest          # exit 0
bridge:fixture: selftest passed ✓
```

Live run, exact task command (started in the worktree background, log to
`.tmp-fixture.log`, then killed by PID):

```
$ POLARIS_OWNER_ADDRESS=GAJW5V7VXHIRTJBGNVYTGXJ6CLDM7IEIPAYD3XLKKTKJKPRBYOTAC25A \
  POLARIS_ALIASES=acc2=GB25QEDATQREAQQHBW3DAGLOZ3EURS44URZETXLLREPPYCX2ABCORNLV \
  node --env-file-if-exists=.env scripts/bridge-fixture.mjs

bridge:fixture: open this URL in your browser:
  http://127.0.0.1:52738/sign?t=<token-redacted>
bridge:fixture: sequence loaded from Horizon.
bridge:fixture: waiting for the page to post a result…
```

`GET /sign/payload?t=<token>` (JSON pasted without the token):

```json
{
  "xdr": "AAAAAgAAAAATbtf1udEZpCZtcTNdPhLGz6CIeDA93WpU1JU+IcOmAQAAAGQASL86AAAAAQAAAAEAAAAAAAAAAAAAAABqryY6AAAAAAAAAAEAAAAAAAAAAQAAAAB12BBgnCJAQgcNtjAZbs7JSMucpHJJ3WuJHvwK+gBE6AAAAAAAAAAAAJiWgAAAAAAAAAAA",
  "networkPassphrase": "Test SDF Network ; September 2015",
  "address": "GAJW5V7VXHIRTJBGNVYTGXJ6CLDM7IEIPAYD3XLKKTKJKPRBYOTAC25A",
  "payloadHash": "b07b5d9ab2845aabc07c17dd2a5fb4fea9a22e88b90cc8510d00c7766ca94d53",
  "summary": {
    "title": "Sign a testnet payment",
    "lines": [
      "From GAJW5V7VXHIRTJBGNVYTGXJ6CLDM7IEIPAYD3XLKKTKJKPRBYOTAC25A",
      "To GB25QEDATQREAQQHBW3DAGLOZ3EURS44URZETXLLREPPYCX2ABCORNLV",
      "Amount 1 XLM (native)",
      "Sequence 20476454152175616 loaded from Horizon"
    ],
    "estimatedFee": "0.0000100 XLM",
    "explorerUrl": "https://stellar.expert/explorer/testnet/account/GAJW5V7VXHIRTJBGNVYTGXJ6CLDM7IEIPAYD3XLKKTKJKPRBYOTAC25A"
  }
}
```

The node process was stopped by its own PID; `.tmp-fixture.log`/`.tmp-fixture.pid`
were deleted. No browser was opened and nothing was submitted. **This also
retires the earlier "online sequence load was not observed" caveat.**

### Blocked / handoff

- **Docs now slightly stale:** `docs/freighter-bridge.md` §5 still documents
  `POLARIS_ALIASES` as "comma-separated G addresses". It now also accepts
  `name=G…`. Updating the docs is outside this task's file scope.
- `backlog.md` / `sprints.md` were **not** touched (explicitly outside scope);
  the coordinator should add the index row / checklist item.
- Real Freighter signing, and the rendered bridge UI, remain unverified (need a
  human with Freighter on Testnet).

---

## Review fixes 2 — apply the REJECT review

- **Date:** 2026-09-20
- **Worker/Agent:** opencode worker (deepseek-v4.1-flash)
- **Branch/Worktree:** `feat/w4a-freighter-bridge-page` / `.worktrees/w4a-bridge-page`
- **Review:** `backlog/w4a-freighter-bridge-page-review.md` (verdict REJECT)

### BLOCKER 1 — the wallet must return the SAME transaction

`app/src/bridge/verify.ts` now parses both envelopes with the payload's
`networkPassphrase` and requires the two **signature-base hashes** to be equal
(`toHex(signed.hash()) === toHex(unsigned.hash())`). This is the review's byte
equality (`Buffer.from(...).equals(...)`); hex is used because the verifier runs
in the browser and the project deliberately avoids the Node `Buffer` global in
browser-safe code (cf. `stellar/src/payments/summary.ts`). The fresh bundle
contains no bare `Buffer.` reference. That hash commits to source,
fee, sequence, time bounds, memo and every operation, so a wallet that returns a
different transaction is rejected even when the source and operation count match.
The signature is then verified by `payload.address` over that same hash. Fee-bump
(and any non-`Transaction`) envelopes are refused, consistent with
`stellar/src/payments/summary.ts`. Previously equal source + equal op count was
enough, so a reviewed "pay 1 XLM to X" could be swapped for another transaction.

The optional `payloadHash` is now used too: when present it must be a hex digest
of the unsigned XDR, else the result is `the payload hash does not match the
unsigned transaction`.

Before the fix (real function, same source + 1 op, different destination/amount/
sequence/fee):

```
unsigned: dest A amount 1  seq 123
signed  : dest B amount 100 seq 999 fee 100
verifySignedXdr -> {"ok":true}
```

After:

```
unsigned: dest A amount 1  seq 123
signed  : dest B amount 100 seq 999 fee 100
verifySignedXdr -> {"ok":false,"reason":"the signed transaction is not the unsigned transaction"}
```

New regression tests in `app/src/bridge/verify.test.ts` (each failed on the
pre-fix code): different destination, amount, sequence, fee, memo, time bounds;
a tampered `payloadHash`; the honest case; a fee-bump envelope; and both
accepted `payloadHash` forms. The existing different-source / different-op-count
/ wrong-signer / malformed tests are kept.

**Decision (flag for the coordinator):** the task's note said the approval flow
defines `payloadHash` as "the SHA-256 hex of the UTF-8 bytes of the base64
unsigned XDR string". The *implemented* approval flow does not: it emits the
transaction signature-base hash (`stellar/src/payments/summary.ts:53,69`,
`payloadHashOf`/`buildPaymentSummary`), and the W4a fixture/docs already do the
same. Rather than silently break the honest path or diverge from the real
contract, `verifySignedXdr` accepts **either** digest (both are functions of the
same unsigned XDR; the mandatory signed-vs-unsigned hash equality is unaffected).
Both forms are documented in `docs/freighter-bridge.md` §2. If the coordinator
wants exactly one form, say which and it is a one-line change.

### MAJOR 2 — user rejection for the real adapter

The kit rejects with a plain `{ code, message, ext }` object (`parseError` in
`node_modules/@creit.tech/stellar-wallets-kit/esm/sdk/utils.js`), not an `Error`.
`isUserRejection` (`app/src/bridge/signFlow.ts`) now reads the message with
`messageOf` and also treats the known Freighter decline code `-4` as a rejection.
The code was confirmed from the shipped dependency: `FreighterApiDeclinedError =
{ code: -4, message: "The user rejected this request." }` in
`node_modules/@stellar/freighter-api`. `app/src/bridge/signFlow.test.ts` adds
tests for the exact kit-shaped object, the code-only shape, an `Error`, a
`string`, a non-rejection kit object, and `undefined`.

### MAJOR 3 — the fixture now verifies the link

`scripts/bridge-fixture.mjs` `verifySigned` receives the unsigned XDR and
`payloadHash` and compares the returned envelope's hash to the unsigned hash
before it can print `signature valid ✓`; it refuses fee-bump envelopes and also
checks `payloadHash`. It is exported, and `scripts/bridge-fixture.test.mjs` now
imports the page's real `verifySignedXdr`
(`../app/src/bridge/verify.ts`) and pins the two to the same fixtures (honest,
different destination/amount/sequence, wrong signer) plus explicit
same-source/same-op-count and tampered-`payloadHash` cases. The duplicate is
intentional: the fixture stays plain `.mjs` (any Node ≥22) while the test, like
the app suite, already relies on type stripping.

### MINOR 4 — docs

`docs/freighter-bridge.md` gains a "Requirements for the Rust server (W4b)"
section: `Host` must equal `127.0.0.1:<port>`; `Origin` absent or exactly
`http://127.0.0.1:<port>`; `Content-Type: application/json` on POST; 64 KiB body
cap; `Cache-Control: no-store` + `Referrer-Policy: no-referrer`; a restrictive
CSP; a method allow-list; constant-time token comparison; single-use + TTL; and
never any CORS header (`Access-Control-Allow-Origin`). The threat-model table and
§2/§3 (`payloadHash`, hash equality) were updated to match; the `POLARIS_ALIASES`
`name=G…` form is now documented (retires the W4a-fix handoff).

### MINOR 5/6 + NITs

- `backlog.md` Open Tasks row and a `sprints.md` “Signing bridge / W4a” checkbox
  were added (this task explicitly allowed those two files).
- NITs fixed: `explorerUrl` is now emitted only when it is a valid `https:`
  URL (`javascript:` etc. are dropped); `runSignFlow(...)` gets a `.catch`; the
  fixture compares tokens with `timingSafeEqual` and attaches the `finish`
  listener before `end()`. The `session.consumed`-before-body ordering is left
  as-is (it is deliberate single-use protection on a loopback dev tool).
- Dependency footprint of `@creit.tech/stellar-wallets-kit@2.6.0` (recorded here
  per the review, not a code change): the lockfile grows by **491
  `node_modules/` entries** vs `origin/main` — the kit declares **19 direct
  dependencies** (incl. `@reown/appkit@1.8.21`, `@walletconnect/sign-client@2.23.0`,
  `@trezor/connect-web@10.0.0-beta.1`, `@ledgerhq/*`, `@stellar/freighter-api@6.0.0`)
  and a large Solana subtree (`@coinbase/cdp-sdk`, `@solana/web3.js`). **Four**
  newly-added packages carry install scripts: `@reown/appkit` (postinstall = a
  local `package.json` version check, no network), `bufferutil`, `secp256k1`,
  `utf-8-validate` (`node-gyp-build` native builds). `fsevents` already existed on
  `main`. None of these modules are reachable from the built bundle's Freighter
  path (see isolation check below).

### Real output

```
$ npm run check                                   # exit 0
> @polaris/{interfaces,agent,stellar,app} ... tsc -p tsconfig.json   (no diagnostics)

$ npm test -w @polaris/app                        # exit 0
ℹ tests 50
ℹ pass 50
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0

$ node --test scripts/bridge-fixture.test.mjs     # exit 0
✔ loads the live sequence from a method-based Horizon account
✔ falls back to the labelled offline placeholder when the loader rejects
✔ a wrong-typed sequence is an error, never a silent offline fallback
✔ parses bare and name-prefixed alias entries down to addresses
✔ the fixture verifier accepts an honest owner signature and matches the payload hash
✔ both verifiers reject a different transaction with the same source and op count
✔ the two verifiers agree on the same fixtures
✔ the fixture verifier rejects a tampered payload hash
ℹ tests 8
ℹ pass 8
ℹ fail 0

$ npm run build -w @polaris/app                   # exit 0 (fresh dist)
✓ 809 modules transformed.
dist/index.html                                  0.52 kB │ gzip:  0.31 kB
dist/bridge.html                                 0.83 kB │ gzip:  0.45 kB
dist/assets/bridge-B0UOhKdb.css                  2.76 kB │ gzip:  1.05 kB
dist/assets/main-BkWtUz4C.css                   16.54 kB │ gzip:  4.26 kB
dist/assets/utils-BSSViwnX.js                    0.51 kB │ gzip:  0.36 kB
dist/assets/classPrivateFieldSet2-DlN4b7Pv.js    2.05 kB │ gzip:  0.99 kB
dist/assets/sac-spec-B3J1ifeu.js                 9.79 kB │ gzip:  3.02 kB
dist/assets/client-CVyLjtFK.js                  67.81 kB │ gzip: 16.23 kB
dist/assets/bridge-DbAbDNI6.js                 121.85 kB │ gzip: 41.37 kB
dist/assets/main-BIB01okB.js                   248.46 kB │ gzip: 78.92 kB
dist/assets/src-Bk7ShMTt.js                    278.53 kB │ gzip: 44.01 kB
dist/assets/transaction_builder-B67xwH7g.js    302.10 kB │ gzip: 72.06 kB
✓ built in 131ms

$ npm run bridge:fixture -- --selftest            # exit 0
bridge:fixture: --selftest (offline, no Freighter)
signature valid ✓  (tx hash 65766df9e44389e9cc112b9c83d29946bda0e70ed8dcc31e4da7af18896a36dc)
signature INVALID: no signature by GB2JMJML6POMZOF2LZZTYM5UUYHXTZWKQW3Q6DOMPJSOX75APXLCTWKH
bridge:fixture: selftest passed ✓
```

Bundle isolation, fresh `dist`:

```
freighter in main chunk:        0
freighter in bridge chunk:      23
bare `Buffer.` refs in bridge:  0   (verification is browser-safe: local toHex + SDK hash)
```

No Rust is in this change, so `cargo test` / `cargo clippy` are not applicable
and were not run.

### Files touched

- `app/src/bridge/verify.ts` (same-transaction binding, payloadHash, fee-bump)
- `app/src/bridge/verify.test.ts` (regression + honest + payloadHash + fee-bump)
- `app/src/bridge/signFlow.ts` (`isUserRejection` via `messageOf`/code `-4`;
  passes `payloadHash`)
- `app/src/bridge/signFlow.test.ts` (kit-shaped / Error / string / undefined)
- `app/src/bridge/types.ts` (`payloadHash` optional + doc)
- `app/src/bridge/main.ts` (https-only explorer URL; flow `.catch`)
- `scripts/bridge-fixture.mjs` (same-transaction verification, timing-safe token,
  `finish` ordering)
- `scripts/bridge-fixture.test.mjs` (pinning tests)
- `docs/freighter-bridge.md` (W4b requirements; payloadHash; threat model; aliases)
- `backlog.md`, `sprints.md`, this report

### Remaining work / handoff

- **Real Freighter signing and the rendered bridge UI are still unverified** —
  unchanged by this fix; they need a human, Freighter on Testnet, and the
  matching account.
- **The `payloadHash` definition is a decision point** (see above): the bridge
  currently accepts both the transaction hash and the SHA-256 of the base64 XDR
  string. Confirm the intended single form for W4b.
- W4b must implement every item in the new "Requirements for the Rust server
  (W4b)" section before it is accepted.

### Blocked / handoff

- Nothing was blocked. No files outside the assigned scope were touched; no
  secrets were read or printed; `POLARIS_ALLOW_AUTO_APPROVE` was not touched.

