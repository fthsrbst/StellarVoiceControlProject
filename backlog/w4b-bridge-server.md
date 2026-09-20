# Report: W4b-1 — Rust bridge server + independent signature verification

- **Date:** 2026-09-20
- **Worker/Agent:** opencode worker (deepseek-v4.1-flash)
- **Branch/Worktree:** `feat/w4b-bridge-server` / `.worktrees/w4b-server`
- **PR:** none (task: leave changes uncommitted; coordinator commits after verifying)

## Objective

Implement the Rust half of the W4b Freighter signing bridge: a one-shot loopback
HTTP session that serves the W4a bridge page and its two protocol endpoints, mints
a one-time token, opens the user's browser, and **independently verifies** the
returned signed envelope before reporting success. Three Tauri commands
(`bridge_sign`, `bridge_selftest`, `bridge_health`), all per the shared W4b
contract in `docs/freighter-bridge.md`.

## What was done

New module `app/src-tauri/src/bridge/` with five files:

1. **`server.rs` — the signing session.** `SigningSession::start` binds
   `tiny_http` on `127.0.0.1:0`, mints a 32-byte token from the OS CSPRNG
   (`getrandom`), and serves on one blocking thread. Enforced, per the doc's W4b
   section: `Host` must equal `127.0.0.1:<port>`; `Origin` absent or that origin;
   only `GET /sign/payload`, `POST /sign/result` and static `GET`; `POST` needs
   `Content-Type: application/json`; 64 KiB body cap (checked at the header and
   while reading); constant-time token compare (`subtle`); single-use completion
   latch (a second post is `410` even after the waiter read the outcome); every
   response carries `Cache-Control: no-store` + `Referrer-Policy: no-referrer`;
   static responses carry the restrictive CSP; no CORS header anywhere. The
   payload endpoint returns `{ xdr, networkPassphrase, address, payloadHash,
   summary }`. Unknown/expired tokens answer `403`/`410`. The `ok` discriminator
   is a JSON boolean, so the result body is deserialized through a private raw
   struct rather than a serde tagged enum.
2. **`verify.rs` — parse-free verification.** Envelope prefix/suffix checks,
   fixed-offset source/fee/sequence reads, the transaction hash
   `SHA-256(SHA-256(passphrase) || 00000002 || body)`, and the signed shape
   `unsigned[..len-4] || 00000001 || hint(4) || 00000040 || signature(64)` with
   byte-equal body, `ed25519-dalek` `verify_strict`, and hint match. One
   `VerifyError` enum, all surfaced as `integrity`.
3. **`strkey.rs` — in-repo StrKey decode.** base32 + version byte + CRC16-XModem,
   returning the 32-byte key; rejects a bad checksum, a `C…`/`M…` address and
   malformed input.
4. **`launch.rs` — browser open.** macOS `open` with the URL as one argument
   (no shell); `POLARIS_BRIDGE_BROWSER` validated against a conservative charset
   before it reaches `open -a`. A `BrowserLauncher` trait keeps tests browser-free.
5. **`commands.rs` — the three commands.**
   - `bridge_sign(id)`: `store.take_authorized(id)` (the gate's only XDR exit);
     `not_authorized` when the gate refuses; verifies the transaction source
     against the configured owner (via the gate's additive `signerHint`) before
     opening; runs the session on the blocking pool; returns `ok` with the Rust
     computed `txHash` only after local verification.
   - `bridge_selftest(xdr)`: same path without the gate. `validate_selftest_xdr`
     refuses any envelope whose source is not the configured owner **or** whose
     sequence number is not exactly `0` (a sequence-0 tx can never be applied
     on-chain), so the self-test cannot sign a real transaction.
   - `bridge_health()`: non-prompting check — loopback bind, page + first script
     asset present, owner configured, browser reported.

Additive changes elsewhere:

- `approval.rs`: `AuthorizedPayload` gains an optional `signerHint`
  (`Option<Vec<u8>>`, `skip_serializing_if`) read from the fixed XDR offset, so
  the bridge can fail closed on a mismatched source without a second decode.
- `stellar_config.rs`: `is_public_key` made `pub(crate)` for the health check.
- `lib.rs`: `mod bridge`, three command registrations, and
  `app.manage(bridge::commands::system_launcher())`.
- `Cargo.toml` / `Cargo.lock`: `tiny_http 0.12`, `ed25519-dalek =2.1.1`,
  `base64 0.23`, `getrandom 0.3`, `subtle 2.6`.

### Decisions

- **`tiny_http`, not a web framework.** It is a small, sync, blocking server with
  no async runtime and only three new transitives (`ascii`, `chunked_transfer`,
  `httpdate`) — the smallest well-maintained fit for a two-endpoint local server.
- **`ed25519-dalek` pinned to exactly `=2.1.1`.** `rustc 1.98` is installed, but
  the crate declares `rust-version = "1.77"`; `2.2.0` raises its MSRV to `1.81`.
  `=2.1.1` (MSRV 1.60) keeps the declared floor honest. `curve25519-dalek 4.1.3`
  and the `getrandom 0.3`/`base64 0.23` picks all stay under 1.77.
- **No XDR/StrKey crate.** The parse-free reader and decoder are small enough to
  audit, per the task.
- **Boolean `ok` discriminator** broke serde's tagged-enum support, so
  `PageResult` is mapped from a private raw struct — the wire shape is unchanged.
- **Dev asset fallback.** Embedded resolver first; if it has no file, read
  `app/dist` next to the repository; if that is absent, answer `404` with
  `run \`npm run build -w @polaris/app\``.
- **Logging.** Only outcome codes and the tx hash are printed; the token and both
  XDRs never are.

## Real output

```
$ caffeinate -i cargo test --manifest-path app/src-tauri/Cargo.toml bridge::
test result: ok. 45 passed; 0 failed; 0 ignored; 0 measured; 179 filtered out

$ caffeinate -i cargo test --manifest-path app/src-tauri/Cargo.toml
test result: ok. 219 passed; 0 failed; 5 ignored; 0 measured; 0 filtered out

$ caffeinate -i cargo clippy --manifest-path app/src-tauri/Cargo.toml --all-targets -- -D warnings
Finished `dev` profile [unoptimized + debuginfo] target(s) in 1.09s
(no warnings)

$ npm run check
> @polaris/{interfaces,agent,stellar,app} ... tsc -p tsconfig.json   (no diagnostics)

$ npm test -w @polaris/app
ℹ tests 121
ℹ pass 121
ℹ fail 0
```

The 45 new bridge tests are included in the 219 total; the pre-change baseline
was **174 passed**. The breakdown by file: 4 strkey, 12 verify, 3 launch,
13 server, 9 commands, plus the shared fixtures they exercise.

The verify module pins the transaction hash to `@stellar/stellar-sdk`: the
fixture's SDK-computed `Transaction.hash()` is
`28db72cef390f4490ce4b4d05ae67c90aefa10d9e11437e14476830f68bfde46`, and
`tx_hash(body, passphrase)` returns exactly that (test
`transaction_hash_matches_the_js_sdk_vector`).

## Files changed

- **New:** `app/src-tauri/src/bridge/{mod,server,verify,strkey,launch,commands}.rs`,
  `backlog/w4b-bridge-server.md`
- **Modified:** `app/src-tauri/src/{lib.rs,approval.rs,stellar_config.rs}`,
  `app/src-tauri/{Cargo.toml,Cargo.lock}`, `docs/freighter-bridge.md`
  (Implementation notes (W4b-1) section appended), `backlog.md`, `sprints.md`
- **Not touched:** `app/src/**` (another worker owns it), `agent/**`, `stellar/**`,
  `interfaces/**`, `.env.example`, `vite.config.ts`, capabilities (no ACL change
  needed — app-defined commands are not ACL-gated).

## Unverified — needs a human

- **Real browser + Freighter round trip.** `bridge_sign` opening the actual
  browser, the user approving in Freighter on Testnet, and the real signature
  coming back were **not** run. The whole server/verification path is exercised
  with real loopback sockets and locally-signed envelopes, but `open` and the
  extension are not.
- **The rendered bridge page in a real browser** is still unverified (W4a's
  caveat).
- **Embedded-asset serving in a packaged app.** The tests use an in-memory asset
  provider; `app.asset_resolver()` serving the real embedded `bridge.html` in a
  bundle was not run (no bundle was built).
- `POLARIS_BRIDGE_BROWSER` selecting a real browser was not run.

## Remaining work / handoff

- **W4b-2 (TypeScript)** consumes `bridge_sign`/`bridge_selftest`/`bridge_health`
  per the contract; `BridgeOutcome` field names are the serde camelCase shape in
  the shared contract.
- The Debug panel button for `bridge_selftest` is W4b-2's; `bridge_health` is
  already a `FeatureHealth` with `id = "w4b.bridge"`, `milestone = "W4b"`.
- `POLARIS_BRIDGE_BROWSER` should be added to `.env.example` by whoever owns that
  file (out of this task's scope; documented in `docs/freighter-bridge.md` §6b).
- Final on-device acceptance needs one human run: start the app with
  `POLARIS_OWNER_ADDRESS` set, approve a payment by Touch ID, sign in Freighter,
  confirm `ok` + the tx hash.

## Blocked / handoff

- Nothing was blocked. No files outside the assigned scope were touched; no
  secrets were read or printed; `POLARIS_ALLOW_AUTO_APPROVE` was not touched.

## Review fixes (W4b-fix)

- **C1 (BLOCKER):** `bridge_selftest` now sends `payload_hash_of_xdr(&xdr)` (sha256 of the base64 XDR, one of the two digests the page accepts, `app/src/bridge/verify.ts:86-92`) instead of sha256(""); `the_selftest_payload_hash_passes_the_page_rule` replicates that rule in Rust so it cannot regress.
- **F1:** `verify_signed` returns a new `VerifyError::SourceMismatch` when `unsigned.source != key`, independent of the gate's `signerHint`; existing verify tests now use a source-matched fixture, plus `rejects_a_source_that_is_not_the_expected_key`.
- **F2:** shared `is_safe_asset_path` rejects `..`, backslashes and doubled slashes before the resolver in both `AppAssetProvider` and `DirAssetProvider`; tested with a resolver that must not be reached.
- **F3 + F4:** the page-supplied `signerAddress` is decoded and compared to the owner key (was a vacuous echo compare), and `read_body` now returns `io::Result<Option<..>>` so a read error is `400` rather than `413`; both tested.
- Verified: `cargo test` 226 passed / 0 failed / 5 ignored (bridge 52, was 45); `cargo clippy --all-targets -- -D warnings` clean.
