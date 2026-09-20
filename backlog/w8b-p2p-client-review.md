# Independent review — W8b P2P escrow TS client, voice intents, panel
- **Reviewer:** L4 (independent; did not write the code)
- **Under review:** `feat/w8b-p2p-client` (`e49f47f`, report `c79e46f`), compared to `origin/main`.
- **Scope note:** `origin/main...HEAD` also drags in the whole `integration/wallet` lane; I reviewed only the W8b commit (`e49f47f`) plus its Rust/types support.

## Verdict: **REJECT** (one BLOCKER; fix + re-run, then it is approvable)

## BLOCKER
**1. `Offer.state` is decoded wrong; every `getOffer`/`listOpen` against the real contract throws.**
`stellar/src/p2p/describe.ts:103-106` expects `raw.state` to be a string (`isOfferState`), but the W8a contract encodes the `OfferState` enum as a **union**, not a symbol. From the contract snapshot (`git show feat/w8a-p2p-escrow-contract:contracts/polaris_p2p_escrow/test_snapshots/test/create_offer_deposits_and_records_the_offer.1.json`): `{"key":{"symbol":"state"},"val":{"vec":[{"symbol":"Open"}]}}`. `scValToNative` maps `scvVec` to an **array**, so `decodeOffer` always throws `simulation_failed: get_offer returned an unknown state: ["Open"]`. The entire P2P panel's read path (list + track) is dead on testnet.
Repro (real SDK, real contract encoding):
```sh
node --experimental-strip-types --input-type=module -e "import {xdr,scValToNative} from '@stellar/stellar-sdk'; import {decodeOffer} from './stellar/src/p2p/describe.ts'; ..."
# native.state = ["Open"]
# decodeOffer THREW: simulation_failed - get_offer returned an unknown state: ["Open"]
```
The tests pass only because the fixture is wrong: `stellar/src/p2p/__tests__/helpers.ts:93` encodes `state` as a bare `scvSymbol(offer.state)`, not `scvVec([scvSymbol(...)])`. So the suite cannot catch this drift.
**Fix:** normalise a `[name]` union (accept `"Open"` or `["Open"]` of length 1; reject anything else) and fix `offerScVal` to the real encoding, with a test that decodes a snapshot-shaped map.

## MAJOR
**2. Seller cannot confirm after `pay_deadline` — the panel steers a paid seller into `reclaim`.**
`app/src/lib/p2pView.ts:103-107`: for `Accepted`+seller, `now >= pay_deadline` returns `"reclaim"` and never `"confirm"`. The contract explicitly allows `confirm_fiat` at any time while `Accepted`, "including after `pay_deadline` — confirming is always in the buyer's favour". A seller who received TRY late has no confirm button and is pushed to reclaim (keeping fiat **and** tokens). Suggest offering both actions after the deadline, with `confirm` keeping the "only after TRY arrived" hint.

## MINOR
**3. Off-by-one at the deadline.** `p2pView.ts:106` uses `nowSeconds >= deadline` for reclaim, but the contract requires `now > pay_deadline` (`reclaim` in `lib.rs`) → at exactly `deadline` the UI offers a call that returns `ReclaimTooEarly`. (The test `p2pView.test.ts:67` locks in the wrong bound.)
**4. Expired `Open` offer still offers Accept.** `nextAction` never checks `expires_at`; a tracked (by id) expired-open offer shows "Accept", which the contract rejects with `OfferExpired`.
**5. `listOpen(0n, 50)` is silently capped at 20.** `P2pPanel.tsx:68` passes 50, but `list_open` clamps `limit` to `MAX_PAGE = 20`; with no pagination, offers id > 20 never appear (only manually tracked).
**6. Accept approval card shows no trade terms.** `client.ts:165-170` accept context is only the id; the card cannot show amount/price/seller, so a misheard/hallucinated `offerId` from the model is approved blind. Fetch the offer (`getOffer`) and put the terms in the summary, or require panel selection.
**7. Misleading `errors.ts` doc / dead codes.** `errors.ts:4-7` says the contract's numeric codes "are not frozen"; W8a states discriminants are public ABI (`200..211`). `invalid_amount` and `offer_not_found` in `P2pRefusalCode` are never constructed.

## NIT
- `stellar/src/p2p/client.ts:41-98` duplicates `guard/invoke.ts` (`buildUnsignedInvoke`/`simulateReadValue`); reuse it.
- `p2pView.ts:66` `formatRate` integer-truncates (34.5 → "34"); acceptable for display, note it.

## Verified correct (re-run, real output)
- `npm run check` → all 4 workspaces, exit 0.
- `npm test -w @polaris/stellar` → keeper **67 pass/0 fail**; vitest **957 pass/0 fail** (p2p **15/15**), total 1024 — matches report.
- `npm test -w @polaris/agent` → **134 pass/0 fail** (8 new).
- `npm test -w @polaris/app` → **181 pass/0 fail** (8 new).
- `cargo test --manifest-path app/src-tauri/Cargo.toml` → **225 passed/0 failed/5 ignored**.
- `cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings` → clean.
- ScVal writes match the ABI: `create_offer(Address,Address,i128,i128,u64)`, `accept/confirm_fiat/cancel/reclaim(Address,u64)`, `list_open(u64,u32)` — arg types asserted in `client.test.ts`; unsigned (0 signatures) — confirmed.
- Contract id is a required option, never a constant; `createP2pClient("")` throws; two ids produce differently-targeted XDR (tested).
- Amounts stay exact bigint decimal strings (no float): `tryToKurus`/`kurusToTry`, `guard.toRawUnits`; TRY price validated `^\d{1,12}(\.\d{1,2})?$` on both agent and chain sides.
- `confirm_fiat` UI warning + Touch ID: `actionHint` says "Confirm ONLY after the TRY arrived", a persistent amber notice, and every panel/voice action runs the gate (`txPipeline`/`executeIntent` + `bridge_sign` requires an authorized approval id) — no value moves without approval.
- Rust `types.rs` P2P variants and `bridge/commands.rs` test literal are additive and genuinely required (serde would reject the new `kind`); `stellar_config.rs` reads only the `POLARIS_P2P_CONTRACT_ID` allow-list entry.
- No secret is exposed to the webview (client takes only public addresses/token SAC), no `.env` read.

## Human-verify (cannot be checked here)
Real `polaris_p2p_escrow` deployment end-to-end; real Mac rendering + Touch ID + Freighter; the contract's `Option`/enum encoding on-chain (the enum encoding is proven from snapshots above, but not against a live RPC).
