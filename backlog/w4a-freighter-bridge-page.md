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

