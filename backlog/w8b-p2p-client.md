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
- Offer state decoding assumes the contract enum serialises as a symbol/string (`scValToNative`); validated offline only.

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
