# Report: w9-spp — Private payments (SPP) inside the app

- **Date:** 2026-09-20
- **Worker/Agent:** opencode-go/deepseek-v4.1-flash
- **Branch/Worktree:** `feat/w9-spp` / `.worktrees/w9-spp` (from `integration/wallet`)
- **PR:** none yet (coordinator commits)

## Finding (item 1 — the deciding question)

The Rust SDK **can** produce signable transactions: `Client::account(user, signer, signer)`
takes a pluggable `Handle<dyn Signer>` trait, and the public `chain` module exposes
`auth_sign_steps()` (each step has `wallet_preimage_b64()` for Freighter `signAuthEntry`) and
`unsigned_tx_for_signing()`. So the SDK does **not** need a raw secret key.

**But** every pool `transact`/`register` uses `sender.require_auth()` → a Soroban
**auth-entry** signature *plus* the envelope signature. The upstream web SDK signs both
(`signAuthEntry` then `signTransaction`); Polaris' `bridge_sign` signs only an envelope.
Full in-app wiring therefore needs a bridge/page extension outside this task's scope, so the
value-moving commands (`spp_prepare_*`) were **not** shipped half-working.

## Delivered (item 3 — read-only, honest outcome)

- `app/src/lib/spp.ts` — pinned contracts (pool/registry/ASP/verifier/SAC), the five verified
  spike tx hashes + explorer links, the public-vs-hidden explainer, and a read-only
  `getLatestLedger` status probe (injected transport). `app/src/lib/spp.test.ts` (10 tests).
- `app/src/panels/PrivacyPanel.tsx` — read-only panel: live pool status, contracts, evidence
  links, caveats, and Deposit / Private transfer / Withdraw shown **disabled** with the reason.
- `app/src/debug/checks/spp.ts` — non-destructive check (contract shape + RPC reachability);
  reports `warn` because wallet signing is not wired.
- Rust: `panels.rs` `privacy` spec + `lib.rs` tray item (additive; allow-list/route/tray tests updated).
- `scripts/spp-demo.md` — reproduce the loop with a throwaway identity **outside** the app.
- `privacy` route wired in `panelRoutes.ts` / `PanelRoot.tsx`.

## Decisions

- No git SDK dependency and no `spp` cargo feature: without the bridge `signAuthEntry` step
  the feature cannot move value, and a 100+ crate + 102 MiB circuit dependency would slow the
  default build for nothing. The Privacy panel reads RPC over plain JSON-RPC instead.

## Verification (exact)

- `npm run check` — green (all workspaces).
- `npm test -w @polaris/app` — **183 passed / 0 failed** (was 173; +10).
- `cargo test --manifest-path app/src-tauri/Cargo.toml` — **225 passed / 0 failed / 5 ignored**.
- `cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings` — clean.
- Live `getLatestLedger` probe confirmed (`sequence` field) against the testnet RPC.

## Blocked / handoff

- **Bridge extension needed:** the bridge page (`app/src/bridge/*`) and Rust `bridge_sign`
  must support Freighter `signAuthEntry` in addition to `signTransaction`, and `verify_signed`
  must accept the auth-entry signature. Only then can `spp_prepare_*` return a fully-signable
  unsigned XDR for the existing `txPipeline.ts`.
- **Local note storage** still needs at-rest encryption (Keychain-backed key) — follow-up.
- **Not verified (needs a human/real machine):** the panel window opening, a real Freighter
  auth-entry round trip, and any on-chain SPP operation from the app.
