# Report: W8b — P2P ramp: TS client, voice intents, P2P panel
- **Date:** 2026-09-20
- **Worker/Agent:** opencode worker (deepseek-v4.1-flash)
- **Branch/Worktree:** `feat/w8b-p2p-client` / `.worktrees/w8b-p2p-client`
- **PR:** none (changes left uncommitted, per instructions)

## What was done
- `stellar/src/p2p/**` (new): `polaris_p2p_escrow` client. `createOffer`/`accept`/`confirmFiat`/`cancel`/`reclaim` return an unsigned `P2pCall` (XDR + summary decoded from that XDR + payload hash); `getOffer`/`nextOfferId`/`listOpen` simulate reads. Contract id is a required option (D9); injected `P2pRpcLike`; typed `P2pRefusal`; TRY↔kurus and token raw-unit conversion with bigints only. Exported as `p2p` (+ root types `Offer`/`P2pClient`) from `stellar/src/index.ts`; `defaultAssetRegistry`/`toSdkAsset` re-exported for the shell.
- Voice: `IntentKind` gains `p2p_offer`/`p2p_accept`/`p2p_confirm` (+ panel-only `p2p_cancel`/`p2p_reclaim`); `Intent` gains optional `priceTry`/`offerId`. New `agent/src/tools/p2p.ts` (three approval-gated tools, strict validation), registered in `createDefaultRegistry`, prompt rules added, exports from `agent/src/index.ts`.
- Shell: `app/src/lib/p2p.ts` (lazy config from `stellar_config`, ChainTools for the voice kinds) routed in `lib/chain.ts` through the existing seam/approver; `app/src/lib/p2pView.ts` pure view model (state machine, next action per state, rate/expiry formatting).
- Panel: `app/src/panels/P2pPanel.tsx` + `panels/p2p/{OfferForm,OfferRow,OfferSection}.tsx`. Open offers, create form, "My offers & trades" with the right next action (Accept / Confirm payment received / Cancel / Reclaim), track-by-id, persistent off-chain-TRY notice, explorer link on the submitted tx. All actions via `useTxRun`/`txPipeline` — never signs in the webview.
- Debug: `app/src/debug/checks/p2p.ts` (W8) — `unknown` when `POLARIS_P2P_CONTRACT_ID` is unset, else live `next_offer_id` read. Rust `stellar_config.rs` gains `p2p_contract_id` (allow-listed `POLARIS_P2P_CONTRACT_ID`) + tests; `StellarConfig` mirror updated; `.env.example` one commented line.
- Required out-of-scope mechanical fixes: `app/src-tauri/src/types.rs` `IntentKind` gained the P2P variants (else the approval gate rejects a P2P intent) and the `bridge/commands.rs` test literal gained `p2p_contract_id` (else the Rust build breaks). Both are additive and unavoidable.

## Decisions
- Only the token is escrowed; TRY is off-chain and never moved by Polaris (stated in UI and summaries). No arbiter.
- `confirm` is offered to the seller only; `reclaim` only after `pay_deadline`. Buyer sees "Waiting for TRY".
- Offer state decoding normalises the contract's `OfferState` union (`["Open"]`, or a bare symbol) and rejects anything else; proven against a snapshot-shaped map and a live testnet read.

## Verification (all run in this worktree)
- `npm run check` (all workspaces): pass.
- `npm test -w @polaris/stellar`: 1024 passed / 0 failed (keeper 67 + vitest 957; 15 new in `src/p2p`).
- `npm test -w @polaris/agent`: 134 passed / 0 failed (8 new).
- `npm test -w @polaris/app`: 181 passed / 0 failed (8 new in `p2pView.test.ts`).
- `npm run build -w @polaris/app`: success.
- `cargo test --manifest-path app/src-tauri/Cargo.toml`: 225 passed / 0 failed / 5 ignored.
- `cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings`: clean.

## Blocked / handoff / human-verify
- Live testnet: contract `polaris_p2p_escrow` is parallel work; `POLARIS_P2P_CONTRACT_ID` unset here, so all client/panel/tests run with mocked RPC.
- Needs a human on a real Mac: panel rendering, Touch ID + Freighter round trip, and the real contract's enum/`Option` encoding.
- The Rust `IntentKind` + bridge test edits are outside the named scope (noted above).

## Review fixes (W8b-fix, 2026-09-20)
- BLOCKER 1: `OfferState` is now decoded as the real union — `["Open"]` or a bare symbol — via `normalizeOfferState` (rejects anything else); `offerScVal` emits `scvVec([scvSymbol(name)])` and new tests decode a snapshot-shaped map. `seller`/`token`/`buyer` are validated as addresses; encodes audited against the ABI (Address/i128/u64/u32 unchanged).
- Live read (simulation only): added `scripts/p2p-live-read.mjs` (`npm run p2p:live`); real testnet output below.
- MAJOR 2/3/4: `nextActions` returns a list; an Accepted seller after `pay_deadline` gets `confirm` + `reclaim`, reclaim needs strict `now > pay_deadline`, and an expired Open offer offers no Accept.
- MINOR 5/6: the panel pages `list_open` by the 20-id window with "Load more offers"; `p2p_accept` (voice) and the panel accept fetch `getOffer` and put amount/price/seller in the summary, so a misheard id is not approved blind.
- MINOR 7: fixed the `errors.ts` doc (discriminants are public ABI `200..211`); removed the dead `invalid_amount`/`offer_not_found` codes.
- NIT: `client.ts` reuses `guard/invoke.ts` (`buildUnsignedInvoke`/`simulateReadValue`); `formatRate` documents its display-only truncation.

## Verification (W8b-fix re-run)
- `npm run check`: all 4 workspaces, exit 0. `npm run build -w @polaris/app`: success.
- `npm test -w @polaris/stellar`: keeper **67 pass/0 fail**; vitest **959 pass/0 fail** (p2p **17/17**), total 1026. `npm test -w @polaris/app`: **182 pass/0 fail**.
- Live read against `CBMXLTXS76…` (source: W8a deployer; nothing signed/submitted):
```
next_offer_id: 2
list_open(1, 20): 0 open offer(s)
get_offer(1): {"id":"1","seller":"GAIDD…TQFK","token":"CD5PX…LNZ7","amount":"1000000000","price_try_kurus":"400000","created_at":"1789866897","expires_at":"1789870497","buyer":"GCH76…TDIRN","accepted_at":"1789866912","pay_deadline":"1789868712","state":"Settled"}
```

