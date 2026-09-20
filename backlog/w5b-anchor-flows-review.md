# Review — w5b-anchor-flows (independent, read-only)

- **Date:** 2026-09-20 · **Reviewer:** opencode reviewer · **Branch:** `review/w5b-anchor` vs `origin/main`
- **Diff reviewed:** `git diff origin/main...HEAD` (W5b changes are in `c490294`; the rest of the diff is the pre-existing integration/wallet lane).
- **Verdict: REJECT** — one BLOCKER makes the non-challenge anchor signing path always throw; plus a MAJOR routing gap on the voice path.

## BLOCKER

**B1 — `defaultSignViaPipeline` never captures the signed XDR (`app/src/lib/anchor.ts:160-178`).**
`let signed: string | undefined` is declared and read (`if (run.status !== "submitted" || !signed)`, `return signed`) but **never assigned**. The `capture.submit` callback (`:164-167`) computes a hash and returns, but does not set `signed`. So every non-challenge anchor tx — the USDC `changeTrust` (via `prepareAccount`/`preflight`) and the withdrawal `payment` (via `payWithdrawal`), both signed by `createAnchorSigner` → `signViaPipeline` — throws `Error("...not approved"/"no signed envelope was produced")` even after Touch ID + Freighter succeed. `createAnchorSigner` is what `createAnchorSession()` (the Anchor panel) and `chain.configureAnchor` install, so the panel's deposit/withdraw cannot sign anything. It fails closed (no value moves, no unsigned fallback) but the feature is non-functional.
Failure scenario: Anchor panel → Start withdraw → `startWithdraw` → `payWithdrawal` → `signer.signTransaction` → `runTx` approves → return → `!signed` → throw.
Fix: assign in the capture, e.g. `submit: async (signedXdr) => { signed = signedXdr; return { hash: anchorTxHash(signedXdr), explorerUrl: "" }; }`. Add a test that drives the **real** `defaultSignViaPipeline` (the current `anchor.test.ts:82` injects a fake `signViaPipeline` and so never exercises it).

## MAJOR

**M1 — The "sequence 0 → wallet-only" policy is not applied on the voice path (`app/src/lib/chain.ts:193-195`).**
`executeApprovedIntent` always ends in `signAndSubmit(outcome, deps)` (`bridge_sign`, Touch ID + Freighter), regardless of the XDR sequence. For a returning user (trustline present) `depositTry` returns the SEP-10 challenge (seq 0) (`stellar/src/anchor/chainTools.ts:84-97`); it is approved and handed to `bridge_sign`, not `bridge_sign_challenge`, then `submitSignedTx` refuses seq 0 (`chainTools.ts:153`) and the login dead-ends (no JWT, deposit never starts). Fails closed, but the stated routing only holds for the panel's session signer, not for voice. Decide: route voice deposit login to the challenge path, or make voice deposit panel-only and document it.

## MINOR

- **m1 — Misleading report claims.** `backlog/w5b-anchor-flows.md:15` says the no-double-submit decision is "covered by `anchor.test.ts`", and `:30` lists real trustline/withdraw signing as merely human-verify. The real pipeline has no test and is broken (B1); correct both after the fix.
- **m2 — `useAnchorFlow.ts:161`** marks the `trustline` step `done` unconditionally, even when `prepareAccount()` added no trustline. `steps.ts:94` maps every `sep6.*` explain to `"deposit"` during a withdraw, and `:97` maps `horizon.balance` to `completed` prematurely. Cosmetic/misleading only.
- **m3 — `isMissingCommandError` (`anchor.ts:52-55`)** matches any message containing `not found`/`no such command`, so a genuine `bridge_sign_challenge` error that happens to contain those words is mislabelled as `AnchorSigningUnavailableError`. Fail-closed either way.

## NIT

- `anchorTxHash` (`anchor.ts:111-117`) defaults to the TESTNET passphrase while the session may use another; the captured hash is compared to `bridge.txHash` in `signAndSubmit`, so a non-testnet config would raise a spurious "Transaction mismatch". Testnet-only today.

## Verified correct (re-checked, not trusted)

- **Wire shapes:** `IntentKind` gains `withdraw` on both sides (`interfaces/src/index.ts:18-24`, `types.rs:14-21`, snake_case kind / camelCase fields); no Rust exhaustive match on kind; clippy clean.
- **Withdraw destination validation (pre-existing, correct):** `sep6.startWithdraw` accepts only a plain `G...` (`StrKey.isValidEd25519PublicKey`), rejects muxed/other and paying our own account; `buildWithdrawPayment` re-checks; `session.payWithdrawal` pays only the session's own stored instruction, binds amount via `toStroops`, and `assertSameTransaction` verifies the signed envelope.
- **Amounts/decimals:** `assertAmount` enforces positive decimal ≤7 places (`amount.ts:3-9`); panel validators reject zero/negative/non-numeric and clamp 50–100 TRY / 1–100 USDC.
- **SEP-10 validation before signing:** `requestChallenge` → `validateChallenge` runs `WebAuth.readChallengeTx` (anchor signing key, seq 0, home domain, `web_auth_domain`, server signature) plus network/client/memo/time-bound/expiry checks; `completeChallenge` re-verifies via `verifyChallengeTxSigners`. Sequence-0 is enforced here independent of the signer.
- **Missing command fails closed:** `defaultSignChallenge` throws `AnchorSigningUnavailableError`; no fallback to signing without approval.
- **No secret leak:** `login()`/`toSessionInfo` never expose the JWT; explain records carry only shortened accounts, amounts, expiry; anchor text is sanitised.
- **Pipeline fail-closed:** `runTx` never reports "submitted" without txHash+explorerUrl.

## Blocked / handoff

- **W5a enforcement is unverifiable here:** `bridge_sign_challenge` does **not** exist anywhere in `app/src-tauri` (grep: only TS references). The `sequence === "0"` decision is TS-only; when W5a lands, **Rust must reject non-seq-0 XDRs** in `bridge_sign_challenge`. On this branch it fails closed only because the command is missing. Must be a W5a review acceptance item.

## Commands re-run

- `npm run check` (all workspaces) — clean.
- `npm test -w @polaris/app` — **186 pass / 0 fail**.
- `npm test -w @polaris/agent` — **133 pass / 0 fail**.
- `npm test -w @polaris/stellar` — all suites pass; anchor suite **197 pass / 0 fail**.
- `cargo test --manifest-path app/src-tauri/Cargo.toml` — **225 passed / 0 failed / 5 ignored**.
- `cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings` — clean.
- `npm run build -w @polaris/app` — built OK.
