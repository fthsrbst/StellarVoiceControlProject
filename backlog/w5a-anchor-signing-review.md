# Review: W5a — anchor SEP-10 wallet-only signing (Rust)

- **Reviewer:** independent (L4), read-only | **Date:** 2026-09-20
- **Under review:** `feat/w5a-anchor-signing` vs `origin/main` (`d754ee9`, `0ef528b`); report `backlog/w5a-anchor-signing.md`
- **Verdict:** **REJECT** — one BLOCKER (small, local fix); everything else is sound.

## Commands run (real)
```
$ cargo test --manifest-path app/src-tauri/Cargo.toml
test result: ok. 243 passed; 0 failed; 5 ignored
$ cargo test ... bridge::                        -> 62 passed; 0 failed
$ cargo clippy ... --all-targets -- -D warnings  -> Finished, no warnings
$ npm run check                                  -> tsc clean (4 workspaces)
$ npm test -w @polaris/agent                     -> tests 126  pass 126  fail 0
```
All report numbers reproduced.

## BLOCKER
1. **Unhandled panic on crafted XDR, reachable from the webview** — `verify.rs:189-196` and `verify.rs:246`.
   `find_signature_list` never requires `list_start` to sit after the fixed header. A 148-byte buffer whose first 4 bytes are the envelope type `00000002` is *also* read as "count = 2, list_start = 0"; both decorations then validate (`length == 0x40` at offsets 8 and 80). `parse_envelope` then executes `&full[BODY_OFFSET..list_start]` = `&full[4..0]` → panic `slice index starts at 4 but ends at 0`.
   Reachable: `bridge_sign_challenge` (registered command) → `validate_challenge_xdr` (`commands.rs:525`) → `parse_envelope`; also via the page-returned `signed_base64` (`verify.rs:372`) and `signer_hint_of` (`approval.rs:750`).
   PoC base64 (200 chars, under the 64 KiB guard) — a single `invoke("bridge_sign_challenge", { xdr })` triggers it:
   `AAAAAgAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgICAgAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQEBAQ==`
   Reproduced with a faithful copy of the slicing code (the module is private): exit 101, same panic. This contradicts the intended `integrity` refusal and is a regression from W4b's `parse_unsigned` (which always had `list_start = len-4 > 4`).
   **Fix:** in `find_signature_list`, `if list_start < SEQUENCE + 8 { continue; }`; or make the body slice fallible (`full.get(BODY_OFFSET..list_start).ok_or(VerifyError::Truncated)?`).

## MAJOR
2. **Docs claim a check that does not exist.** `backlog.md`'s W5a row says "`manage_data`-only" and `sprints.md` says "seq-0/owner-source/manage_data integrity checks"; the code (and the report) deliberately dropped the op-type check. Reword both lines (e.g. "seq-0/owner-source checks") so auditors are not misled about a security control.

## MINOR
3. `verify.rs:185`: doc says "the last `c * 76 + 4` bytes"; `DECORATION_LEN = 72` and the code uses `c * 72 + 4`. Correct the number.
4. `verify.rs:344`: the "anchor" decoration is checked for shape only (64-byte length), never for a valid hint/signature. Defensible (the anchor verifies its own signature), but the docs/report should say "presence only", not imply verification.
5. Count heuristic takes the smallest structurally matching count, so a legitimate challenge whose anchor signature ends in `0000000000` is misparsed as unsigned and rejected (`ChallengeNoServerSignature`); likewise a 2-sig result. ~2^-32, non-exploitable, but it is the same root cause as #1.

## Verified correct (code + tests)
- **Seq offset soundness:** `parse_envelope` enforces type `2` then a non-muxed `KEY_TYPE_ED25519` source before reading offset 44; muxed (`0x100`), v0, fee-bump (type 5) and prefixed inputs are all rejected, so the sequence cannot be shifted. `validate_challenge_xdr` then rejects `sequence != 0` before the gate. Tests: `challenge_command_refuses_a_nonzero_sequence_payment`, `a_nonzero_sequence_challenge_is_refused`, `a_challenge_payment_body_is_refused`.
- **Seq-0 unsubmittable claim:** protocol-correct (`tx.seqNum == account.seqNum + 1`; a fresh account starts at 0, so the minimum valid seq is 1; the inner tx's seq is still checked inside a fee-bump wrapper). Not verified against a live core.
- **Shape checks:** owner-source rejected (`ChallengeOwnerSource`), exactly one prior signature required (`ChallengeNoServerSignature`, tested for 0/2/3), byte-identical body (`BodyMismatch`), exactly one added owner hint+signature via `verify_strict` over the real tx hash — all tested.
- **Reachability:** `begin_wallet_only`/`authorize_wallet_only` are `pub(crate)` inherent methods, not commands; `approval_begin` uses `begin` (rejects WalletOnly) and `approval_authorize` uses `authorize_with` (refuses WalletOnly). The only creator is `bridge_sign_challenge`, after the seq-0 check. `take_authorized` marks `Consumed` once (no replay). `challenge` plumbing switches `finish` to `verify_challenge` and skips the owner-hint check only in challenge mode; normal path unchanged. `bridge_selftest` and `bridge_sign_challenge` share machinery but use distinct validators.

## Human-verify (not run)
Live browser + Freighter challenge round trip; a real anchor challenge XDR.
