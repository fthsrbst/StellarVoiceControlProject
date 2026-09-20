# Independent Review: W4b-1 — Rust Freighter bridge server + signature verification

- **Date:** 2026-09-20
- **Reviewer:** independent reviewer (L4); did not write this code
- **Under review:** `review/w4b-server` commits `ac3e4f1`, `7f7c47f` vs `origin/main` (`91e7156`)
- **Report reviewed:** `backlog/w4b-bridge-server.md`
- **Scope:** `app/src-tauri/src/bridge/**`, additive `approval.rs`, `stellar_config.rs` visibility, `lib.rs`, `Cargo.{toml,lock}`, `docs/freighter-bridge.md`

## Verdict: APPROVE WITH CORRECTIONS

The security-critical machinery is correct and fail-closed: one-time 256-bit
token, constant-time compare, single-use latch, Host/Origin DNS-rebinding guard,
64 KiB cap, no CORS, pinned tx-hash, byte-exact signed-vs-unsigned check, strict
Ed25519 verify, and a self-test that can only sign a sequence-0 (unsubmittable)
transaction. One functional blocker: `bridge_selftest` cannot complete a real
round trip because it sends a wrong `payloadHash`.

## What I ran (exact commands, real output)

| Command | Result |
|---|---|
| `export PATH="$HOME/.cargo/bin:$PATH"; caffeinate -i cargo test --manifest-path app/src-tauri/Cargo.toml` | `test result: ok. 219 passed; 0 failed; 5 ignored` |
| `caffeinate -i cargo test --manifest-path app/src-tauri/Cargo.toml bridge::` | `45 passed; 0 failed` |
| `caffeinate -i cargo clippy --manifest-path app/src-tauri/Cargo.toml --all-targets -- -D warnings` | `Finished` — 0 warnings |
| `npm run check` | `interfaces`, `agent`, `stellar`, `app` tsc clean |
| `caffeinate -i npm test -w @polaris/app` | `tests 121, pass 121, fail 0` |

Report numbers match (219/5/45 breakdown is slightly off: actual verify 15, server 14 — total 45 correct).

## Correction required before merge

- **C1 — BLOCKER (functional): `bridge_selftest` always fails at the page.**
  `commands.rs:314` sets `payload_hash: crate::approval::payload_hash_of_xdr("")`
  = `sha256("")` = `e3b0c4…b855`, which is neither the tx hash nor
  `sha256(base64 XDR)`. The W4a page rejects it (`app/src/bridge/verify.ts:86-92`),
  posts `{ok:false, code:"error", error:"the payload hash does not match the
  unsigned transaction"}`, and the Rust bridge reports failure. Fix:
  `payload_hash_of_xdr(&xdr)` (or an empty string, which the page treats as
  absent). Not caught because `PageLauncher` ignores `payloadHash` and no test
  drives `bridge_selftest` through the page.

## Findings (non-blocking)

- **F1 MINOR (defence-in-depth):** `verify.rs:172` `verify_signed` never compares
  `unsigned.source` to `key`; the source-vs-owner binding rests solely on the
  optional `signer_hint` populated by the gate (`approval.rs:709`). Add
  `if unsigned.source != *key { return Err(...) }`. In practice the hint is
  always present when the envelope parses, so `bridge_sign` is safe; this just
  makes the "independent verification" claim true on its own.
- **F2 MINOR (dev-only):** `AppAssetProvider` (`server.rs:198-211`) applies no
  `..` validation, unlike `DirAssetProvider`. Under a Tauri dev build (`devUrl`
  set) `AssetResolver::get` joins `frontendDist` with the raw path and does not
  drop `ParentDir` components, so a raw local client can read outside `app/dist`
  (e.g. `GET /../../app/src-tauri/Cargo.toml` with a valid `Host`). Not reachable
  from a browser (`..` normalized) and not a privilege boundary vs a local
  process, but the bridge should reject `..` before calling the resolver.
- **F3 NIT:** `commands.rs:183` `signer_address != payload.address` is vacuous —
  the page posts `payload.address`, not the connected address; the comment
  overstates it.
- **F4 NIT:** `read_body` (`server.rs:551`) reports any read error as `413`.
- **F5 NIT (dead code):** `mod.rs:35-36` unused re-export under
  `#[allow(unused_imports)]`; `server.rs:742-745` unused `health_timestamp`
  under `#[allow(dead_code)]` ("future async variant").

## Verified correct

- **Token:** 32 CSPRNG bytes (`getrandom`) as hex; `subtle` constant-time compare
  (length not secret); single-use `completed.swap` latch independent of outcome
  read → second POST `410` even after the waiter took the value (tested).
- **Host/Origin:** Host must equal `127.0.0.1:<port>`; Origin absent or exactly
  that origin; foreign Host/Origin → `403` (tested); no CORS header ever; DNS
  rebinding cannot pass Host.
- **Body:** POST requires `application/json`; cap enforced at header and while
  reading; `413` on oversize (tested).
- **Headers:** `Cache-Control: no-store` + `Referrer-Policy: no-referrer` on
  every response; CSP on static (tested).
- **Tx hash:** `SHA-256(SHA-256(passphrase) ‖ 00000002 ‖ body)` equals
  `@stellar/stellar-sdk` `Transaction.hash()` vector `28db72…de46` (tested).
- **Signed shape:** prefix byte-equal, exactly one sig
  (`00000001‖hint‖00000040‖sig`), hint == `key[28..32]`, `verify_strict` over the
  hash; wrong passphrase/tampered/extra-sig/body-reorder/truncated rejected.
- **StrKey:** base32 `A-Z2-7` + version `0x30` + CRC16-XModem little-endian,
  checked against real fixtures; rejects bad checksum, lowercase, `C…`/`M…`.
- **Self-test:** source == owner **and** sequence == 0 at the fixed envelope
  offsets (8, 44); sequence 0 can never apply on-chain; no other path. (C1
  breaks the round trip but not the safety rule.)
- **`take_authorized`** is the only XDR exit, requires `Authorized` (Touch ID via
  `authorize_with`), marks `Consumed`, second call refused (tested); XDR never
  returned to the webview.
- **Launch:** `open` with the URL as one argument, no shell;
  `POLARIS_BRIDGE_BROWSER` charset-validated, invalid treated as unset.
- **Logs:** only outcome + tx hash; token/XDRs never printed.
- **Scope:** `app/src/**`, `agent/**`, `stellar/**`, `interfaces/**`,
  `.env.example` untouched.

## Needs a human (not verified here)

Real browser + Freighter round trip; embedded resolver serving `bridge.html` in a
packaged app; `POLARIS_BRIDGE_BROWSER` selecting a real browser.
