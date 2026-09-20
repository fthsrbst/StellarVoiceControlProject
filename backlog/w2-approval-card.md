# Report: W2 — Approval card window (UI only)

- **Date:** 2026-09-20
- **Worker/Agent:** opencode (deepseek-v4.1-flash)
- **Branch/Worktree:** `feat/w2-approval-card` in `.worktrees/w2-approval-card`
- **PR:** none (changes left uncommitted for the coordinator to verify and commit)

## Completed

The approval card UI is built against the W3 Tauri command contract, with a pure
state machine separated from presentation. No Rust, `interfaces/`, `App.tsx` or
notch code was touched.

- **`app/src/lib/approval.ts`** — typed wrappers over `invoke` for
  `approval_current`, `approval_authorize(id)`, `approval_deny(id)`, plus
  `createApprovalCommands(invokeImpl?)`. `invoke` is injected
  (`InvokeFn`) so tests mock it. `toApprovalError` normalises any rejection into
  `{ kind, message }` with `kind` ∈ `cancelled | failed | unavailable | timeout |
  expired | notPending`; unknown shapes become `failed` (fail-closed).
  `ApprovalSnapshot` mirrors the contract and never carries the XDR.
- **`app/src/panels/approval/approvalFlow.ts`** — pure reducer (no React/Tauri).
  States `idle → pending → authorizing → authorized | denied | expired`, plus
  terminal `error`. Approve is live only in `pending` before `expiresAtMs`;
  `authorizing` locks against a double click; `cancelled` returns to `pending`
  with the calm hint; `tick(now)` and `nowMs` come from an injected clock;
  unknown snapshot states and unknown error kinds fail closed. `consumed` maps to
  `authorized` (already authorised and used).
- **`app/src/panels/approval/summaryLines.ts`** — line parser: `To …` / `To: …`
  and `Fee …` / `Fee: …` become label/value pairs; every other line is kept
  verbatim (a bad label only ever downgrades to plain, never drops a line).
- **`app/src/panels/approval/ApprovalCard.tsx`**, **`SummaryLines.tsx`**,
  **`HashFingerprint.tsx`** — the view: header supplied by `PanelShell`
  (“Approve transaction”), large summary title, summary rows, estimated fee,
  first-8 + last-8 payload-hash fingerprint (monospace, full hash in the tooltip,
  best-effort copy), mode label (“Touch ID required” / “Wallet signature
  required”), live countdown, Approve (“Approve with Touch ID”) and Deny with
  disabled/loading states, and result copy (authorized/denied/expired/error).
  Default focus is **Deny**; Esc denies; Approve needs an explicit click; amounts
  and addresses are monospace via the pair rows.
- **`app/src/panels/ApprovalPanel.tsx`** — container. Hydrates from
  `approval_current()` on mount and re-reads on every `approval_request` /
  `approval_result` event (subscribe first, then snapshot). Applies a
  matching-hash result immediately, ignores a different one, and runs the 1 s
  countdown while pending/authorizing.
- **Demo mode** — `app/src/panels/approval/demo.ts` fixtures + mocked commands;
  `#/approval?demo=1` simulates a 1 s Touch ID then flips to authorized,
  `?demo=expired` and `?demo=error` cover the other cards. A mandatory
  “DEMO — nothing is signed” banner is rendered in demo mode. Real mode never
  imports a fixture.
- **`app/src/panels/panelRoutes.ts`** — added `parseApprovalDemo(hash)` (query in
  the hash) returning `live | expired | error | null`; `parsePanelRoute` itself
  is unchanged, so existing behaviour/tests stand. `PanelRoot.tsx` was **not**
  touched: `ApprovalPanel` reads the hash through this helper.
- **Tests** — `approval.test.ts`, `approvalFlow.test.ts`, `summaryLines.test.ts`,
  and new cases in `panelRoutes.test.ts`: every transition, double-click lock,
  expiry via injected clock, cancelled→pending, unknown-state fail-closed,
  hydration from a snapshot in every state, result-hash mismatch, error
  normalisation and each command path with a mocked invoke, route parsing incl.
  `?demo=`, and line parsing.
- **Docs** — added “8. Approval card (`#/approval`)” to `docs/ui-panels.md`
  (states, hydration, command contract, demo URLs).

## Verification (real output)

```
> @polaris/app@0.1.0 check
> tsc -p tsconfig.json
(exited 0, no diagnostics)

$ npm test -w @polaris/app
ℹ tests 62
ℹ suites 0
ℹ pass 62
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0

$ npm run build -w @polaris/app
✓ 771 modules transformed.
✓ built in 452ms
(exited 0; only the pre-existing >500 kB chunk-size warning)
```

Rust was not touched, so `cargo test` / `cargo clippy` were not run.

## Unfinished (handed off)

- **Debug panel contract.** The card ships its Debug-panel check later, after the
  Debug panel milestone lands. That check should assert: (a) `#/approval` with no
  `demo` never renders the DEMO banner or a fixture, while `?demo=1|expired|error`
  always does; (b) Approve is disabled in every non-`pending` stage and while
  `authorizing`; (c) the countdown reaches `expired` at `expiresAtMs`; (d) a
  result event with a different `payloadHash` does not move the card; (e) no
  `ApprovalSnapshot` ever exposes the XDR. Do **not** create `app/src/debug/**`
  here (another worker owns it).
- **`backlog.md` / `sprints.md` rows.** The task’s generic ground rules asked for
  one `backlog.md` row and a `sprints.md` tick, but this task’s explicit scope
  says **do not edit `backlog.md` or `sprints.md`** (they are shared with the
  concurrent Debug-panel worker). Following the explicit scope, neither file was
  touched; the coordinator should add the row/tick at merge, or delegate it.

## Blocked / handoff

- Nothing code-blocked. Human verification is required for: the visual review of
  the card (spacing, focus ring, countdown legibility) and the real Touch ID
  prompt/denial once W3 lands. `approval_authorize` is coded to the contract but
  was only exercised against a mocked `invoke` and the 1 s demo stub — **not
  verified** against a real prompt.

## Review Notes

- Candidate for review: the `consumed → authorized` mapping and the
  `notPending → error` choice are the two contract states with no dedicated card
  stage; both fail closed and are documented in the reducer.
- `ApprovalCard` focuses Deny through a wrapper `querySelector` because the
  shared `Button` does not forward a ref and `components/ui/button.tsx` is outside
  this task’s scope. If ref forwarding is added later, replace the wrapper.

## Suggested Next Step

W3 lands the Rust gate; run the card against the real `approval_*` commands and
a real Touch ID prompt, then have the frontend owner restyle `ApprovalCard.tsx`
(the reducer and command seam should not need to change).
