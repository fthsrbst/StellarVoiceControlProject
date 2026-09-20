# Review: W1 — Network wiring

- **Date:** 2026-09-20
- **Reviewer:** independent worker (L4) — did not write this code
- **Change under review:** branch `review/w1-network` vs `origin/main` (`git diff origin/main...HEAD`, `git log origin/main..HEAD`)
- **Commits:** `62cf808` feats (agent build-then-approve), `09cc08f` (stellar_config + chain.ts), `16f27e4` (e2e:build-xdr), `892be30` (report)
- **Author report:** `backlog/w1-network-wiring.md`
- **Verdict:** **APPROVE WITH CORRECTIONS** (no BLOCKER; 2 MAJOR latent, several MINOR/NIT)

> No signing or submission exists in this change, so nothing here can move value
> today. The MAJOR findings are latent binding/robustness defects that must be
> settled before the signing milestone; they do not make W1 itself unsafe.

---

## 1. Commands re-run (real output)

All commands from the worktree root with `export PATH="$HOME/.cargo/bin:$PATH"` and `caffeinate -i` where long.

| Command | Result |
|---|---|
| `npm run check` | PASS — interfaces, agent, stellar, app all `tsc` clean (exit 0) |
| `npm test -w @polaris/agent` | **114 pass / 0 fail** (`tests 114, pass 114`) |
| `npm test -w @polaris/app` | **19 pass / 0 fail** |
| `npm test -w @polaris/stellar` | PASS (exit 0): anchor 8 files/**197**; payments 7/**121**; guard 7/**133**; approval 4/**112**; schedule 5/**121**; suggest 4/**145**; live 12/**112**; keeper node:test **67** |
| `cargo test --manifest-path app/src-tauri/Cargo.toml` | **130 passed; 0 failed; 5 ignored** (exit 0) |
| `cargo test … stellar_config` | **7 passed; 0 failed** |
| `cargo clippy … -- -D warnings` | **exit 0, 0 warnings/errors** (`Finished dev profile`) |
| `npm run e2e:build-xdr -- 1` (read-only) | **exit 0** — reproduced a live testnet unsigned XLM XDR (below) |
| SHA-256 cross-check vs `node:crypto` | PASS on 9 inputs incl. 56-byte 2-block, 1 M-byte, 1000-byte, Turkish/emoji UTF-8 |

The e2e script was re-run independently (read-only GET to Horizon, no secret):

```
owner: GAJW5V7VXHIRTJBGNVYTGXJ6CLDM7IEIPAYD3XLKKTKJKPRBYOTAC25A
summary.explorerUrl: .../testnet/tx/d64428799b6fbf4e63a08d7417946ad946a6610fc0071fa26adac1ca0867f74e
payloadHash: d64428799b6fbf4e63a08d7417946ad946a6610fc0071fa26adac1ca0867f74e
unsignedXdr: AAAAAgAAAAATbtf1udEZpCZtcTNdPhLGz6CIeDA93WpU1JU+IcOmAQAAAGQASL86AAAAAQAAAAEA
```

(Values differ from the report's run because the sequence number/time bounds are
live; the shape is identical.)

---

## 2. What I verified as correct

- **No secret can reach the webview through `stellar_config`.** `stellar_config.rs:104-119` reads only the 7 allow-listed names; `ownerAddress`/alias addresses are `G…`-shape-filtered (`:51-57`, `:89-96`); nothing else is serialized (`:33-48`). Vite `envPrefix` (`app/vite.config.ts`) lists only `VITE_`, `TAURI_ENV_`, `POLARIS_AGENT_MODEL`, `POLARIS_AGENT_PROVIDER`, `POLARIS_ALLOW_AUTO_APPROVE` — **not** `POLARIS_OWNER_ADDRESS`/`POLARIS_ALIASES`, so the command is indeed the only route. `cargo test never_returns_env_vars_outside_the_allow_list` passes.
- **Approval seam is fail-closed on the value-moving paths.** `executeIntent` (`execution.ts:336-403`): `unsupported` / `unavailable` (NotImplemented) / `not_configured` / generic tool throw all return before `approver.approve`; approver throw → `failed`/`Approval error`; deny → `rejected`. Confirmed by `approveCalls == 0` tests and by my own probe (`undefined approver` → `failed`/`Approval error`, no throw).
- **The approved outcome cannot carry a result when the approver denied.** Deny branch (`:392-400`) returns no `result`/`payloadHash`; tests assert both `undefined`.
- **Hand-rolled SHA-256 is correct.** Compared against `node:crypto` for `""`, `"abc"`, the fox sentence, a 56-byte 2-block input, 1000 bytes, `"a"×1_000_000`, 64×`"ü"`, Turkish+emoji: all match. The multi-block loop, 64-bit length split and UTF-8 `TextEncoder` path are sound.
- **Alias merge precedence and validation.** `chain.ts:85-88` spreads `{...committedAliases, ...envAliasEntries(config.aliases)}` → env wins; `parseAliasBook` re-validates names, checksums and `network === "testnet"` and throws on any bad entry (fail-closed).
- **TS/Rust wire shape matches.** Rust `#[serde(rename_all="camelCase")]` produces `network/rpcUrl/horizonUrl/networkPassphrase/ownerAddress/aliases/guardContractId`, byte-identical to `interfaces/src/index.ts:218-226`; pinned by `serializes_to_the_ts_camel_case_shape`.
- **`POLARIS_ALLOW_AUTO_APPROVE` is untouched and still requires the explicit `=== "1"` opt-in** (`chain.ts:48`); the placeholder is not the default (`resolveApprover`).
- **No Rust panics/unwraps on the command path.** `unwrap()` appears only in `#[cfg(test)]`.
- **Report's headline test claims match reality** for agent (114), app (19), Rust (130), clippy clean — see the one exception in M-3.

---

## 3. Findings

### MAJOR

**M-1 — Two different values share the name `payloadHash`; the seam binds the wrong one.**
`executeIntent` computes `payloadHash = sha256Hex(result.unsignedXdr)` — SHA-256 of the **XDR string** (`execution.ts:375`, `:254-256`). The chain lane's `payloadHashOf` is SHA-256 of the **transaction signature base** (`stellar/src/payments/summary.ts:53-55`, `Transaction.hash()`), and that is also what the tool puts in `summary.explorerUrl` (`summary.ts:69,80`), what `e2e-build-xdr.mjs:60` prints as `payloadHash`, and what `SigningService.sign(payloadHash)` / `PolarisEvent::approval_request.payloadHash` are defined around (`interfaces/src/index.ts:70,168-172`; `app/src-tauri/src/events.rs:94`).
Concrete evidence for one and the same fresh XDR (independent run above):
- agent `payloadHash` (string hash) = `8c07e7dd0cbd8e2bafcd5c52fa8aaed80832fefb10799cb032930e076f27d03f`
- chain/e2e "payloadHash" (sig base) = `d64428799b6fbf4e63a08d7417946ad946a6610fc0071fa26adac1ca0867f74e`
Failure scenario: when the Touch ID gate is wired to `ApprovalRequest.payloadHash` (string hash) while the Rust signer checks its approval record / `SigningService.sign` against the tx hash, the approval is recorded against a value no signer will ever check. Worst case the approval label is reused for a *different* XDR that the signer is handed without re-deriving the hash. Not a BLOCKER only because **no signer/submitter is wired in W1**, so nothing moves; the report does hand the reconciliation off (report §Decisions, §Unfinished).
Suggested fix (in scope, small): have the composition root inject the chain hash instead of defaulting — `chain.ts:135` → `executeIntent(intent, { approver, chainTools, payloadHash: (xdr) => payloadHashOf(xdr, config.networkPassphrase) })`, re-exporting `payloadHashOf` from `stellar/src/index.ts` (currently omitted from the additive block, `index.ts:48-55`). Alternatively carry the tool's `payloadHash` through `ChainToolResult` so both hashes come from one place. Either way, add a test that pins "agent hash ≠ tx hash unless reconciled" so the two cannot be confused again.

**M-2 — A tool result without `unsignedXdr` is reported as `executed` with a bogus hash.**
`result.unsignedXdr` is read at `execution.ts:375` with no validation. A tool returning `{ summary }` (undefined XDR) yields `status:"executed"`, `result` without an XDR, and `payloadHash = sha256("")` (`e3b0c442…`); the approval card then renders an empty summary. The tool contract guarantees an XDR, so callers are trusted, but the seam exists precisely to be the safety boundary and should fail closed. Verified by probe:
```
malformed tool result -> executed hash= e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```
Suggested fix: after `result = await tool(intent)`, return `failed`/`Chain error` if `typeof result?.unsignedXdr !== "string" || !result.unsignedXdr`. Related: `result.summary` is likewise unchecked.

### MINOR

**m-3 — Report's stellar test table is inaccurate.** `backlog/w1-network-wiring.md:114-123` reports approval 121 / payments 133 / guard 112. Re-run actual: **approval 112, payments 121, guard 133** (the three numbers are rotated), and the file counts for approval/guard are swapped too (approval 4 files, guard 7). Total is unchanged (1008), all suites pass. Documentation only — but the report labels it "real output".

**m-4 — `executeIntent`'s "Never throws" contract has holes.** `options.chainTools[intent.kind]` (`:340`) and `decision.approved` (`:392`) are outside any `try`, so `chainTools === undefined` throws and an approver resolving to `undefined`/`null` throws `TypeError` (probe verified). Both are caller/impl bugs and still fail closed via `App.tsx`'s `.catch`, but the documented contract is violated. Suggested fix: begin with `const tool = options.chainTools?.[intent.kind]` and treat a non-object decision as `failed`/`Approval error`.

**m-5 — SHA-256 tests don't cover the inputs the task flagged.** `execution.test.ts:292-305` uses only `""`, `"abc"`, and the 43-byte fox sentence (all single-block, ASCII). No multi-block and no UTF-8 case, so a padding/`TextEncoder` regression would pass CI. Also `payloadHashOfXdr` is tested as `sha256Hex(...) === sha256Hex(...)` (`:307-309`), a tautology that cannot fail. Add the NIST 56-byte vector, a ≥56-byte UTF-8 string, and assert the literal expected digests.

**m-6 — Owner address is validated by shape only, then used without a checksum check.** `stellar_config.rs:51-57` accepts any 56-char `G[A-Z2-7]+`; a single-character typo preserving the shape becomes `ownerAddress`, and the error only surfaces as a Horizon `loadAccount` failure → `Chain error` (`executeApprovedIntent`), not the friendly `"Set POLARIS_OWNER_ADDRESS"` label. Fail-closed at the network, but the report's "malformed → null" claim is shape-deep. Suggested fix: validate with a StrKey/checksum check in Rust (or validate `config.ownerAddress` in `chain.ts` before use).

**m-7 — "Testnet only" is a default, not an invariant.** `STELLAR_NETWORK`, `STELLAR_NETWORK_PASSPHRASE` and `STELLAR_HORIZON_URL` are returned verbatim (`stellar_config.rs:107-112`) and passed straight into `defaultPaymentDeps` (`chain.ts:90-95`), so a mainnet passphrase/Horizon is accepted. No signing today, so no value moves; worth an explicit guard or a documented assumption before signing lands.

**m-8 — Stale docs after the signature change.** `IntentApprover.approve` now takes `ApprovalRequest`, but `notes.md:439` and `backlog/2026-09-19-a9-execution-seam.md:103,289` still describe `approve(intent)` / "tool NOT called on deny" — both now false (the tool *is* called before the gate). Documentation drift outside this task's scope, but it contradicts the new contract.

### NIT

- **n-9 — `interfaces/src/index.ts` has no trailing newline** (`\ No newline at end of file`).
- **n-10 — Scope creep, acceptable but note the omission.** `stellar/src/index.ts:48-55` additive re-exports were not in the stated file scope; they are required for `chain.ts` to call `configurePayments(defaultPaymentDeps(...))` and change no behaviour. However `payloadHashOf` (needed for the M-1 fix) is still not re-exported, so the composition root cannot inject it today.
- **n-11 — Weak allow-list test.** `never_returns_env_vars_outside_the_allow_list` (`stellar_config.rs:182-196`) only asserts the JSON lacks the substring `"secret"`; it would still pass if a *different* non-listed variable were returned. Assert the exact serialized key set instead.
- **n-12 — Unused config fields.** `network`, `rpcUrl`, `guardContractId` from `StellarConfig` are returned but never consumed by `chain.ts` (guard route not wired). Fine for the interface, but dead until then.

---

## 4. Security invariants checklist

| Invariant | Status |
|---|---|
| No secret keys in app/webview/repo through this change | PASS (allow-list + envPrefix verified) |
| Value-moving actions fail-closed (deny by default) | PASS for the seam; M-1/M-2 are latent for the future signer |
| `POLARIS_ALLOW_AUTO_APPROVE` never enabled by this code | PASS (`=== "1"` opt-in only) |
| No `unwrap`/panic on the Rust command path | PASS |
| No `.env` read/printed by the reviewer | PASS (no `.env` touched) |

---

## 5. Corrections requested before merge

1. **M-1:** reconcile the two `payloadHash` definitions — inject the chain lane's tx-signature-base hash at the seam (or surface it from the tool) and add a regression test; at minimum rename/doc so the string hash is never labelled `payloadHash`.
2. **M-2:** reject a `ChainToolResult` without a non-empty `unsignedXdr` as a labelled `failed` outcome.
3. **m-3:** correct the stellar suite counts in `backlog/w1-network-wiring.md`.
4. **m-4/m-5:** tighten the "never throws" path and add multi-block + UTF-8 SHA-256 vectors (drop the tautological hash test).

None of these requires new scope; 1 and 2 are a few lines each. Once 1–2 land (or are explicitly accepted as a documented, tracked handoff to the signing milestone), this branch is mergeable.
