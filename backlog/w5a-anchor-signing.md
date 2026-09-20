# Report: W5a — anchor SEP-10 wallet-only signing (Rust)

- **Date:** 2026-09-20 | **Worker:** opencode worker (deepseek-v4.1-flash)
- **Branch/Worktree:** `feat/w5a-anchor-signing` / `.worktrees/w5a-anchor-rust` | **PR:** none

## Objective
Sign a SEP-10 login challenge with the wallet **without Touch ID**, because a seq-0 challenge (anchor-signed) can never be applied on-chain. Every other anchor step stays on Touch ID; the webview-facing `approval_begin`/`approval_authorize` must still be unable to create or authorize a `WalletOnly` request.

## Done (Rust bridge only; no TS/React)
- **`bridge/verify.rs`** — signature list found from the end for `count in 0..=4` by structure, so `parse_envelope` reads 0/1/2-sig envelopes (`parse_unsigned` = the empty-list wrapper; ambiguity/garbage tests). New `verify_challenge` enforces v1 envelope, **seq == 0**, source ≠ owner, **exactly one** prior signature, body byte-identical, and exactly one added owner Ed25519 signature. New errors → `integrity`.
- **`bridge/commands.rs`** — `bridge_sign_challenge(xdr)` refuses non-seq-0 / owner-sourced / unsigned / non-base64 XDR before the gate, runs the full state machine via in-process `begin_wallet_only` → `authorize_wallet_only` → `take_authorized`, then verifies with `verify_challenge`. `anchor_signing_health` reports loopback bind + owner + seq-0 rule. `RunContext` gained a `challenge` flag (normal path unchanged).
- **`approval.rs` (additive)** — `authorize_wallet_only(id)`: in-process, non-command, fail-closed (`NotWalletOnly` for a non-WalletOnly request). `begin_wallet_only` keeps its "webview cannot authorize" test.
- **`lib.rs`** — registered both new commands.

## Decisions
- **Op-type check dropped (task's documented fallback).** A v1 transaction's variable-length `Preconditions` sit between sequence and memo/operations, so the op count is not at a fixed offset and a parse-free walk is infeasible. Residual risk (a malicious anchor gaining a signature over a seq-0 tx of its choosing) is outside Polaris's trust boundary and documented in the `verify` module docs. Core safety is the seq-0 rule + anchor-sig + same-body + owner-sig.
- Fixture from `@stellar/stellar-sdk` 17.1.0: `Account(anchor, "-1")` (the SDK adds 1) yields seq 0; hash `07a83694…9bda3892` pinned as a constant.
- Owner-as-source refused: signing it could authorize an owner action.

## Real output
```
$ cargo test --manifest-path app/src-tauri/Cargo.toml
test result: ok. 243 passed; 0 failed; 5 ignored   (baseline 219, +24; bridge 62, was 56)
$ cargo clippy --manifest-path app/src-tauri/Cargo.toml --all-targets -- -D warnings
Finished `dev` profile   (no warnings)
$ npm run check          # tsc interfaces/agent/stellar/app — no diagnostics
$ npm test -w @polaris/agent   # tests 126  pass 126  fail 0
```

## Unverified — needs a human
Real browser + Freighter round trip for a challenge (as with W4b) and a live anchor's actual challenge XDR were not run.

## Blocked / handoff
Nothing blocked; no out-of-scope files, no secrets, `POLARIS_ALLOW_AUTO_APPROVE` untouched. W5b (TS) consumes `bridge_sign_challenge` / `anchor_signing_health` (debug id `w5a.anchor.signing`, milestone `W5a`).
