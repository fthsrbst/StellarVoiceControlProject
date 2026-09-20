# Report: F3 — STT reliability for commands
- **Date:** 2026-09-20 · **Worker:** opencode worker (deepseek-v4.1-flash) · **PR:** none (uncommitted)
- **Branch/Worktree:** `fix/f3-stt-vocab` / `.worktrees/f3-stt-vocab` (from `integration/wallet`)

## Completed
- **Vocabulary prompt:** `stt::DEFAULT_PROMPT` (bilingual examples + terms) plus alias names from `POLARIS_ALIASES` (keys only, never addresses), sent as the `prompt` field. `POLARIS_STT_PROMPT` overrides verbatim, `=off` disables.
- **Language policy:** forced `POLARIS_STT_LANGUAGE` is accepted unchanged; otherwise a detection outside `POLARIS_STT_ALLOWED_LANGS` (default `tr,en`) re-runs the same bytes **once** with the first allowed language, logging `stt: detected <x> not allowed, retried <y>`. Never loops.
- **Hallucination filter:** blank text always rejected; known phrases (`you`, `thank you`, …) rejected for clips < 700 ms as `SttError::Hallucination` (label `No speech`). Retention/timeouts untouched.
- **Transport seam:** `GroqTransport` + `HttpTransport`, so the retry flow is tested with a scripted transport and no network.
- **Probe:** `scripts/stt-probe.mjs` (`npm run stt:probe`) synthesises 6 `say` clips → 16 kHz mono via `afconvert` → real Groq calls (auto / +prompt / forced-tr / +prompt); key via `--env-file`, never printed, audio deleted.
## Files
`app/src-tauri/src/stt.rs`, `app/src-tauri/src/stt/groq.rs`, `scripts/stt-probe.mjs`, `package.json` (one script), `.env.example`, `backlog.md`, `sprints.md`.

## Verification
- `cargo test`: **236 passed / 0 failed / 5 ignored** (stt module 46 passed, 2 ignored). `cargo clippy --all-targets -- -D warnings`: clean. `npm run check`: clean. `npm test -w @polaris/app`: **173 pass / 0 fail**.
- `npm run stt:probe` (24 requests); representative rows (full table in the PR/terminal):

| sample | variant | detected | text |
|---|---|---|---|
| tr-acc1-acc2 | auto | Turkish | `ACC1'den ACC2'ye 10XLM'ye gönder.` |
| tr-acc1-acc2 | auto+prompt | Turkish | `acc1'den acc2'ye 10 XLM gönder.` |
| tr-hesap | auto | Turkish | `2 numaralı hesaba 10xlm yolla.` |
| tr-hesap | auto+prompt | Turkish | `2 numaralı hesaba 10 XLM yolla.` |
| en-acc2 | auto | English | `Send 10XLM to ACC2` |
| en-acc2 | auto+prompt | English | `Send 10 XLM to acc2.` |

- Prompt fixes tokenisation (`10XLM` → `10 XLM`); auto detected `Turkish`/`English` correctly. Forced `tr` echoes Turkish for English clips (documented trade-off), text unaffected.

## Human-verify / Blocked
Real mic run on the owner's Mac (the Russian/hallucination case was intermittent and not reproduced); confirm `=off` and `POLARIS_STT_ALLOWED_LANGS` live. No blockers.
