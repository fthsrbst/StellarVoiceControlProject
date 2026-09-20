# Report: W8a — polaris_p2p_escrow (Soroban contract)
- **Date:** 2026-09-20 · **Worker:** opencode / deepseek-v4.1-flash
- **Branch/Worktree:** `feat/w8a-p2p-escrow-contract` · `.worktrees/w8a-escrow` · **PR:** none yet

## Completed
- New crate `contracts/polaris_p2p_escrow` with the fixed ABI: `create_offer`, `accept`,
  `confirm_fiat`, `cancel`, `reclaim`, `get_offer`, `next_offer_id`, `list_open`; added
  as a workspace member.
- Seller locks a SEP-41 token into custody; seller confirms fiat and it releases to the
  buyer; `cancel`/`reclaim` refund. No admin, no upgrade path, multi-tenant (only the id
  counter is shared), checked arithmetic, paged scans, an event on every transition.
- Typed `Error` at **200-211** (clear of the SAC's 1-13 and the guard's 100-116).
- Deployed to testnet; create→accept→confirm demo ran (see `contracts/DEPLOYED.md`).
## Decisions
- **SEP-41 `transfer`, not `transfer_from`/allowance:** the seller's `create_offer`
  signature covers the nested deposit as a sub-invocation, so no `approve` step; payouts
  are `contract -> x`. `price_try_kurus` is the **total** asking price for `amount`, and
  the fiat leg is not enforced on-chain (unobservable). Both documented in `lib.rs`.
- **No arbiter (out of scope):** a buyer who paid TRY can lose the race to a dishonest
  seller's `reclaim` after `pay_deadline`. Headline limit in the crate docs.
- Boundaries: expiry inclusive (`now >= expires_at`), accepted-reclaim strict
  (`now > pay_deadline`); `list_open` scans `[start, start+limit)`, limit ≤ 20.
## Files touched
`contracts/Cargo.toml`, `contracts/Cargo.lock`,
`contracts/polaris_p2p_escrow/{Cargo.toml,src/lib.rs,src/test.rs}`,
`contracts/DEPLOYED.md` (append), this report, one line each in `backlog.md`/`sprints.md`.
## Verification (real)
- `cargo test --manifest-path contracts/Cargo.toml`: **38 guard + 20 escrow = 58 passed, 0 failed**.
- `cargo clippy --manifest-path contracts/Cargo.toml --all-targets -- -D warnings`: **clean**.
- `stellar contract build`: `polaris_p2p_escrow.wasm`, 12,663 bytes, 8 exports, sha256
  `59822484…` (matches `DEPLOYED.md`).
- Testnet deploy `CBMXLTXS76S72SIPLVMCQOSS6SN2CR4V3Q73GZPRA4GRIBEM7RE5OLJW`; demo moved
  100 W8USD seller→escrow→buyer (raw balances pasted in `DEPLOYED.md`).
- Not verified (human/UI): no wallet, Touch ID, mic or Freighter; the on-chain demo did
  create→accept→confirm only — cancel/reclaim/paging/7-day TTL cap are host-test covered.
## Blocked / handoff
- None. For the parallel TS client: bind against the deployed id, and surface the
  **no-arbiter** limit and `list_open` window semantics in the order-book UI.
