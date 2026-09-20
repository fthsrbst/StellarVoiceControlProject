# Report: W1 — Network wiring (real unsigned testnet XDR for a voice payment)

- **Date:** 2026-09-20
- **Worker/Agent:** opencode worker (deepseek-v4.1-flash)
- **Branch/Worktree:** `feat/w1-network-wiring` in `.worktrees/w1-network`
- **PR:** none yet (coordinator commits after review)

## Objective

Join the voice lane (`agent/`, `app/`) and the chain lane (`stellar/`): (a) expose
the real testnet network config + owner address to the shell, and (b) reorder the
execution seam so the chain tool **builds the unsigned XDR first**, and the
approval gate then sees the decoded `summary` + `payloadHash`.

## Completed

1. **`stellar_config` Rust command** (`app/src-tauri/src/stellar_config.rs`, new;
   registered in `lib.rs`). Reads only an allow-list of env vars
   (`STELLAR_NETWORK`, `STELLAR_RPC_URL`, `STELLAR_HORIZON_URL`,
   `STELLAR_NETWORK_PASSPHRASE`, `POLARIS_OWNER_ADDRESS`, `POLARIS_ALIASES`,
   `GUARD_CONTRACT_ID`) and returns
   `{ network, rpcUrl, horizonUrl, networkPassphrase, ownerAddress, aliases, guardContractId }`.
   - Owner address and alias addresses are validated against the `G...` StrKey
     shape; alias names against `[a-z][a-z0-9_-]{0,31}`. A malformed owner
     address becomes `null` (fail-closed); malformed alias pairs are dropped.
   - A test pins that no other env var (a provider key, keeper secret) can appear
     in the serialized result.
2. **TS seam type + wrapper**: added `StellarConfig` to `interfaces/src/index.ts`
   (additive, §7) and `app/src/lib/stellarConfig.ts` (`getStellarConfig()`).
   Deliberately **not** in the Vite `envPrefix`, so the only path from `.env` to
   the webview is this validated command.
3. **Execution seam reorder** (`agent/src/execution.ts` + `execution.test.ts`).
   `executeIntent` is now: resolve tool → **run tool (unsigned XDR + summary)** →
   compute `payloadHash` → `build ApprovalRequest { intent, summary, payloadHash }`
   → `approver.approve(request)` → return `{ status: "executed", result, payloadHash }`.
   - `IntentApprover` now receives the card-level `ApprovalRequest`.
   - Added a pure, environment-independent `sha256Hex` / `payloadHashOfXdr`
     (no `node:crypto`, no `crypto.subtle`; works in the webview and under
     `node --test`), injectable via `ExecuteIntentOptions.payloadHash` for tests.
   - Deny/throw/unsupported/`not_configured` keep labelled, never-throw outcomes;
     a deny discards the built result (no `payloadHash`).
4. **`app/src/lib/chain.ts`**: lazily configures Owner B's payment tool via
   `configurePayments(defaultPaymentDeps(...))` on the first intent, using the
   `stellar_config` values and the committed `stellar/config/aliases.json` merged
   with env aliases (env wins), both re-validated by `parseAliasBook`. Missing
   owner address → labelled outcome `"Set POLARIS_OWNER_ADDRESS"`. The fail-closed
   approver + `POLARIS_ALLOW_AUTO_APPROVE=1` semantics are unchanged.
5. **Live read-only proof** `scripts/e2e-build-xdr.mjs` + root npm script
   `e2e:build-xdr`. Builds a real unsigned native-XLM payment XDR against testnet
   Horizon; never signs, never submits, never reads a secret.
6. **XLM intent validation** covered by a new `payment.test.ts` case
   (`"acc2'ye 10 XLM gönder"` → `{ kind: "send", asset: "XLM", amount: "10", recipient: "acc2" }`).
   XLM was already supported (`assets.ts`, prompt, validator); no validation was
   weakened.
7. `.env.example`: commented `POLARIS_OWNER_ADDRESS=` / `POLARIS_ALIASES=`
   placeholder lines (no real addresses).

## Files touched

- `app/src-tauri/src/stellar_config.rs` (new), `app/src-tauri/src/lib.rs`
- `interfaces/src/index.ts` (additive `StellarConfig`)
- `app/src/lib/stellarConfig.ts` (new), `app/src/lib/chain.ts`
- `agent/src/execution.ts`, `agent/src/execution.test.ts`, `agent/src/index.ts`,
  `agent/src/tools/payment.test.ts`
- `stellar/src/index.ts` (additive re-exports — see note below)
- `scripts/e2e-build-xdr.mjs` (new), `package.json`, `.env.example`
- `backlog/w1-network-wiring.md`, `backlog.md`, `sprints.md`

## Decisions

- **Outcome discriminator stays `status`, not `kind`.** The task sketch said
  `{ kind: "approved", ... }`; the existing `ExecutionOutcome` uses
  `status: "executed"` and `app/src/App.tsx` (out of scope) consumes it, so the
  success outcome keeps `status: "executed"` and gains `payloadHash`.
- **The agent seam's `payloadHash` is the XDR digest, by decision (W1-fix).** It is
  lowercase-hex SHA-256 of the UTF-8 bytes of the base64 unsigned-XDR string — the
  value the Touch ID gate and the `approval_request`/`approval_result` events use,
  computable in Rust without XDR parsing, and binding the exact blob a signer is
  handed. It is **not** Owner B's `payloadHashOf` (SHA-256 of the signature base,
  i.e. `Transaction.hash()`), which identifies the transaction on-chain and appears
  only in the chain summary's explorer URL. After review, the two are deliberately
  kept as separate values; the helper is named `xdrDigest` in code and the field is
  only called `payloadHash` at the gate/event boundary (see the Review fixes
  section, M-1).
- **`stellar/src/index.ts` was extended additively** (re-exported
  `configurePayments`, `defaultPaymentDeps`, `parseAliasBook`, `PaymentRefusal`,
  and the `AliasBook`/`PaymentDeps` types). This file was not in the listed scope,
  but `chain.ts` cannot call `configurePayments(defaultPaymentDeps(...))` without
  these being part of the package's public surface. No behaviour changed — exports
  only. Flagged here per the ground rules.
- **`aliases.json` import**: `chain.ts` imports the committed book by relative
  path (there is no package subpath export for it); the env aliases are merged
  over it, so no user-specific address enters the committed file.
- **Tool runs before the gate.** Safe by contract: a `ChainTool` only builds an
  unsigned XDR (plus one read-only Horizon `loadAccount` for the sequence number)
  and never signs or submits.

## Test output (real)

`npm run check` (all workspaces): passed (interfaces, agent, stellar, app — tsc clean).

`npm test -w @polaris/agent`:
```
ℹ tests 118
ℹ pass 118
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

`npm test -w @polaris/app`:
```
ℹ tests 19
ℹ pass 19
ℹ fail 0
```

`npm test -w @polaris/stellar` (exit 0):
```
keeper (node:test):  tests 67   pass 67   fail 0
anchor:              Test Files 8 passed (8)   Tests 197 passed (197)
approval:            Test Files 4 passed (4)   Tests 112 passed (112)
payments:            Test Files 7 passed (7)   Tests 122 passed (122)
guard:               Test Files 7 passed (7)   Tests 133 passed (133)
schedule:            Test Files 5 passed (5)   Tests 121 passed (121)
suggest:             Test Files 4 passed (4)   Tests 145 passed (145)
live:                Test Files 12 passed (12) Tests 112 passed (112)
```
(Counts corrected per review finding m-3: approval/guard were rotated and their
file counts swapped; `payments` is 122 after the M-1 regression test.)

`caffeinate -i cargo test --manifest-path app/src-tauri/Cargo.toml` (exit 0):
```
test result: ok. 131 passed; 0 failed; 5 ignored
```
`stellar_config` module: **8 passed; 0 failed** (defaults, allow-list, no-other-env
with an exact key-set assertion, malformed owner, bad-checksum owner, malformed
aliases, camelCase shape, alias charset).

`caffeinate -i cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings`:
clean (finished without warnings).

`caffeinate -i npm run build -w @polaris/app`: `✓ built in 540ms` (Vite bundles the
JSON alias import; only the pre-existing >500 kB chunk warning).

### Live read-only proof (`e2e:build-xdr`, 1 XLM → `acc2`)

Command (values passed on the command line; the worktree has no `.env`):
```
POLARIS_OWNER_ADDRESS=GAJW5V7VXHIRTJBGNVYTGXJ6CLDM7IEIPAYD3XLKKTKJKPRBYOTAC25A \
POLARIS_ALIASES=acc2=GB25QEDATQREAQQHBW3DAGLOZ3EURS44URZETXLLREPPYCX2ABCORNLV \
npm run e2e:build-xdr -- 1
```
Output:
```
owner: GAJW5V7VXHIRTJBGNVYTGXJ6CLDM7IEIPAYD3XLKKTKJKPRBYOTAC25A
intent: send 1 XLM to acc2 (GB25QEDATQREAQQHBW3DAGLOZ3EURS44URZETXLLREPPYCX2ABCORNLV)
horizon (read-only): https://horizon-testnet.stellar.org
summary:
{
  "title": "Send 1 XLM to acc2",
  "lines": [
    "Pay 1 XLM (native)",
    "To acc2 (GB25QEDATQREAQQHBW3DAGLOZ3EURS44URZETXLLREPPYCX2ABCORNLV)",
    "Network: Test SDF Network ; September 2015",
    "Fee: 0.00001 XLM"
  ],
  "explorerUrl": "https://stellar.expert/explorer/testnet/tx/e25263d221fb3fe8ee65452c48c6b6a21a07733c43faaf576329a0dd5a80c040",
  "estimatedFee": "0.00001 XLM"
}
payloadHash: e25263d221fb3fe8ee65452c48c6b6a21a07733c43faaf576329a0dd5a80c040
unsignedXdr: AAAAAgAAAAATbtf1udEZpCZtcTNdPhLGz6CIeDA93WpU1JU+IcOmAQAAAGQASL86AAAAAQAAAAEAAAAAAAAAAAAAAABqryLdAAAAAAAAAAEAAAAAAAAAAQAAAAB12BBgnCJAQgcNtjAZbs7JSMucpHJJ3WuJHvwK+gBE6AAAAAAAAAAAAJiWgAAAAAAAAAAA
nothing was signed or submitted
```

## Unfinished (handed off)

- **Signing + submission** (later milestone): the `executed` outcome now carries
  `result` + `payloadHash`, but nothing signs or submits. The Touch ID / approver
  must bind to the reconciled payload hash (see Decisions).
- **The `stellar_config` Tauri command is not invoked by a real window in this
  environment** (no running app / webview); verified only via Rust unit tests,
  `cargo clippy`, and the TS type/wrapper. Human smoke test: launch the app with
  `POLARIS_OWNER_ADDRESS` set and confirm the config round-trips.
- **`e2e:intent`** was left as-is; it now reports a `not_configured` tool as the
  labelled `"Chain not configured"` outcome (previously the tool ran after the
  approver). Not re-run (needs a live provider key).

## Blockers

- None for the stated scope.

## Review Notes

- Security invariants respected: no secret enters the app/webview/repo; the
  allow-list test covers the "never return another env var" rule; the approver is
  fail-closed by default and `POLARIS_ALLOW_AUTO_APPROVE` is untouched.
- The only out-of-scope edit is the additive `stellar/src/index.ts` re-export; the
  reviewer should confirm that is acceptable (or move the export to an agreed
  subpath in a follow-up).

## Suggested Next Step

- Signing milestone: add the Touch ID gate over `ApprovalRequest.payloadHash`
  (the XDR digest), then submit and emit `tx_submitted`.

## Review fixes (W1-fix)

Applied the independent review (`backlog/w1-network-wiring-review.md`) per the
coordinator's decisions. What changed per finding:

- **M-1 — the two hashes are now impossible to confuse.**
  - **Decision (unchanged seam):** at the approval gate the `payloadHash` stays the
    lowercase-hex SHA-256 of the UTF-8 bytes of the base64 unsigned-XDR string (the
    "XDR digest"). The Stellar transaction hash is a different value and is used
    only by the chain summary / explorer URL.
  - The agent helper `payloadHashOfXdr` is renamed to **`xdrDigest`**, and the
    `ExecuteIntentOptions.payloadHash` override to **`xdrDigest`**; the field is
    called `payloadHash` only at the gate/event boundary (`ApprovalRequest`,
    `ExecutionOutcome`, the `approval_request`/`approval_result` events).
  - Added a prominent doc block in `agent/src/execution.ts` and a comment block in
    `interfaces/src/index.ts` (comments only, no shape change) stating both
    definitions and the rule that the tx hash must never be passed where the digest
    is expected.
  - Added a regression test that pins **both** values for one fixed XDR fixture
    (digest `c1d5910a…`, tx hash `2f38a676…`, digest ≠ tx hash) and asserts the
    seam's `payloadHash` is the digest, never the tx hash. The stellar suite pins
    the same fixture's tx hash via `payloadHashOf`, so swapping either side fails.
  - `scripts/e2e-build-xdr.mjs` now prints both, labelled `xdrDigest` and `txHash`
    (it previously mislabelled the tx hash as `payloadHash`).
  - Re-exported `payloadHashOf` from `stellar/src/index.ts` with a warning comment
    (n-10), so the tx-hash helper is reachable and explicitly distinct.
- **M-2 — malformed tool results fail closed.** `executeIntent` now validates the
  tool result (`isUsableToolResult`): a missing/empty `unsignedXdr` or a malformed
  `summary` returns a labelled `failed` / `Chain error` and never opens the gate.
  Tests cover `{}`, `{summary}`, empty string, and several malformed summaries.
- **m-3 — corrected the stellar suite counts** in the Test output section above
  (approval 112/4 files, payments 122/7, guard 133/7; the old table had them
  rotated and the file counts swapped).
- **m-4 — the "never throws" contract has no holes.** `chainTools` is read with
  optional chaining (an undefined tool set → `unsupported`), and a non-object
  approver decision (`undefined`/`null`) becomes `failed` / `Approval error`.
  Both are pinned by tests.
- **m-5 — SHA-256 vectors broadened.** Added the NIST 56-byte multi-block vector
  (`248d6a61…`) and a 72-byte UTF-8 (Turkish + emoji) vector
  (`e1bcfee4…`); removed the tautological `sha256Hex === sha256Hex` test and now
  assert literal digests.
- **m-6 — owner/alias addresses are checksum-validated.** `stellar_config.rs` now
  decodes the base32 StrKey and verifies the version byte (`0x30`) and the
  CRC16-XModem checksum, so a shape-valid typo is rejected (fail-closed) instead of
  surfacing later as a Horizon error. New test pins a bad-checksum address → `null`.
- **m-8 — stale docs corrected.** `notes.md` and
  `backlog/2026-09-19-a9-execution-seam.md` no longer describe the old
  `approve(intent)` signature / "tool NOT called on deny"; they now match the W1
  build-then-approve order and the card-level `approve(request)`.
- **NITs.** n-9: trailing newline added to `interfaces/src/index.ts`. n-10:
  `payloadHashOf` re-exported (above). n-11: the allow-list test now asserts the
  exact serialized key set, not just the absence of `"secret"`. n-12: `network`,
  `rpcUrl`, `guardContractId` remain interface fields with no consumer until the
  guard route is wired — noted, not removed (removing them would change the wire
  shape).

### Verification after the fixes

`npm run check`: clean (interfaces, agent, stellar, app — `tsc` exit 0).

`npm test -w @polaris/agent`: **118 passed / 0 failed** (was 114; +M-2, +m-4).
`npm test -w @polaris/app`: **19 passed / 0 failed**.
`npm test -w @polaris/stellar` (exit 0): keeper **67**; anchor 8/**197**; approval
4/**112**; payments 7/**122**; guard 7/**133**; schedule 5/**121**; suggest
4/**145**; live 12/**112**.
`caffeinate -i cargo test --manifest-path app/src-tauri/Cargo.toml`: **131 passed;
0 failed; 5 ignored**.
`caffeinate -i cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings`:
clean (`Finished dev profile`, no warnings).

Live read-only `e2e:build-xdr` (same env values as the original proof):
```
POLARIS_OWNER_ADDRESS=GAJW5V7VXHIRTJBGNVYTGXJ6CLDM7IEIPAYD3XLKKTKJKPRBYOTAC25A \
POLARIS_ALIASES=acc2=GB25QEDATQREAQQHBW3DAGLOZ3EURS44URZETXLLREPPYCX2ABCORNLV \
npm run e2e:build-xdr -- 1
```
```
owner: GAJW5V7VXHIRTJBGNVYTGXJ6CLDM7IEIPAYD3XLKKTKJKPRBYOTAC25A
intent: send 1 XLM to acc2 (GB25QEDATQREAQQHBW3DAGLOZ3EURS44URZETXLLREPPYCX2ABCORNLV)
horizon (read-only): https://horizon-testnet.stellar.org
summary:
{
  "title": "Send 1 XLM to acc2",
  "lines": [
    "Pay 1 XLM (native)",
    "To acc2 (GB25QEDATQREAQQHBW3DAGLOZ3EURS44URZETXLLREPPYCX2ABCORNLV)",
    "Network: Test SDF Network ; September 2015",
    "Fee: 0.00001 XLM"
  ],
  "explorerUrl": "https://stellar.expert/explorer/testnet/tx/f3afd8f7a31e5c48a905a12300513de3e4fae97f0c39a3101fc07c4be09f4e1d",
  "estimatedFee": "0.00001 XLM"
}
xdrDigest: 26c1cbddd076dfa85ffd55d25257b5c82e69e97c46e09178a8933d3cc30d72f6
txHash: f3afd8f7a31e5c48a905a12300513de3e4fae97f0c39a3101fc07c4be09f4e1d
unsignedXdr: AAAAAgAAAAATbtf1udEZpCZtcTNdPhLGz6CIeDA93WpU1JU+IcOmAQAAAGQASL86AAAAAQAAAAEAAAAAAAAAAAAAAABqryehAAAAAAAAAAEAAAAAAAAAAQAAAAB12BBgnCJAQgcNtjAZbs7JSMucpHJJ3WuJHvwK+gBE6AAAAAAAAAAAAJiWgAAAAAAAAAAA
nothing was signed or submitted
```

All deferred/human-verified items from the original report still stand (live
window, Touch ID, real submission); none was claimed as verified here.
