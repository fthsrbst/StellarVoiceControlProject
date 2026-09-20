# Report: merge-fix-integration
- **Date:** 2026-09-20
- **Worker/Agent:** opencode worker (deepseek-v4.1-flash)
- **Branch/Worktree:** `integration/wallet` · `.worktrees/integration-wallet`
- **PR:** none (coordinator commits)

## What was broken (naive "keep both sides")
Duplicated/misplaced blocks from merging five feature branches:
- `interfaces/src/index.ts`: `IntentKind` union restarted mid-list; P2P field doc-comment missing its `/**`.
- `agent/src/index.ts`: schedule/p2p export blocks lost their `export {` opener; duplicate `POLARIS_SYSTEM_PROMPT`/`withDetectedLanguage` export.
- `agent/src/prompt.ts`: two `POLARIS_SYSTEM_PROMPT` declarations; orphan `assetRules()` call/definition; duplicate docs.
- `agent/src/runtime.ts`: duplicate header line; `.register(...);` statements terminated before the next call; registry only sent+anchor.
- `agent/src/tools/registry.ts`: `ToolContext` doc-comment missing its opener.
- `app/src/lib/chain.ts`: duplicate `import("@polaris/stellar")` line.
- `app/src-tauri/src/bridge/commands.rs`: duplicate `let config` initializer.
- `sprints.md`: duplicated T6 line run onto the W6a line.

## Fix (intent-preserving, no features)
Restored each file to the union of all five branches with each intent kind/tool exactly once, keeping syntax and ordering. `prompt.ts` keeps the pre-merge capabilities-based `POLARIS_SYSTEM_PROMPT` (the W6b standalone prompt array was an older side of the same merge); every tool still reaches the capability list via `createDefaultRegistry().definitions()`. No security invariant touched: fail-closed approver and `POLARIS_ALLOW_AUTO_APPROVE` unchanged.

## Verification (counts)
- `npm run check` — clean (all 4 workspaces).
- `npm test -w @polaris/agent` — **168 pass / 0 fail**; `@polaris/app` — **258/0**; `@polaris/stellar` — **272/0** (145+15+112).
- `npm run build -w @polaris/app` — built OK.
- `cargo test --manifest-path app/src-tauri/Cargo.toml` — **243 pass / 0 fail / 5 ignored**.
- `cargo clippy --manifest-path app/src-tauri/Cargo.toml --all-targets -- -D warnings` — clean.
- Probe (worktree source): both "Send 10 XLM to account 2" and "send 10 XLM to wallet 2" → `recipient:"acc2"`; no keys printed.

## Blocked / handoff
- The provided `probe.mjs` imports the **main** checkout (hardcoded `/Users/.../StellarVoiceControlProject/agent/src`), not this worktree; `main` predates `accountRefs.ts`, so it printed `"account 2"`. Re-ran the identical probe against this worktree's `agent/src` to get `acc2`. Coordinator may want a worktree-relative probe script.
