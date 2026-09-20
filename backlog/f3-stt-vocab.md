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

## F3-fix — the prompt leaked into short clips
- **Prompt is now in the language in use** (`stt::{DEFAULT_PROMPT_EN, DEFAULT_PROMPT_TR, DEFAULT_PROMPT}`): forced `en`/`tr` builds that language only (one natural example sentence + recipients in a sentence), auto keeps a short bilingual sentence. No more Turkish terms on an English clip.
- **Filters** (`stt.rs`): prompt-echo (≥60 % prompt words and no leading-digit amount, or a ≥12-char literal prompt run, clips < 3 s), forced-language mismatch, known phrases; minimum clip raised to **700 ms** (`wav::MIN_DURATION_MS`, `Too short` pre-API). `Transcriber::{prompt,forced_language}` expose the hint to the free pre-flight; on-device stays unfiltered.
- **Agent:** `agent/src/prompt.ts` adds an unintelligible-transcript rule + few-shot (`[en] Sorry, I didn't catch that.`) and a 120-char cap; `prompt.test.ts`.
- **Verified:** `cargo test` **240 passed/0 failed/5 ignored**; `cargo clippy --all-targets -D warnings` clean; `npm run check` clean; `npm test -w @polaris/agent` **129 pass**, `-w @polaris/app` **173 pass**.
- **Live probe** (`npm run stt:probe`, 27 calls): all 6 speech samples `ok` (`Send 10 XLM to acc2.` etc.); junk clips 0.7/1.0/1.5 s come back as `Recipients are acc2.`/`Altyazı M.K.`/`Raric…` — **no Turkish vocabulary echo**; the echo cases are flagged `prompt-echo`, the rest are caught by the agent rule.
- **Note:** scope named `agent/src/capabilities.ts`, which does not exist on this branch (it lands on `integration/wallet`); the equivalent system prompt is `agent/src/prompt.ts`, edited there. `POLARIS_STT_LANGUAGE`/`_PROMPT` docs refreshed in `.env.example`.
- **Human-verify:** real-mic run on the owner's Mac (English-forced short clip), `POLARIS_STT_PROMPT=off`, and `POLARIS_STT_ALLOWED_LANGS` live. No blockers.

## F3-agent — rule ported into the capabilities prompt (`integration/wallet`)
- `agent/src/capabilities.ts`: unintelligible/empty-transcript behaviour bullet (`"[en] Sorry, I didn't catch that."` / `"[tr] Anlayamadım."`, no advice/lists) + 120-char spoken cap + a no-tool few-shot; every existing capability/alias/few-shot kept.
- `agent/src/prompt.test.ts` re-pointed at the composed `POLARIS_SYSTEM_PROMPT` (adds the `[en]` tag and Turkish fallback); no test deleted — `capabilities.test.ts` does not cover this rule.
- Verified: `npm run check` clean; agent **182 pass / 0 fail**, app **354 pass / 0 fail**; live `e2e-prompt-eval` **33/33 = 100 %** (incl. two unintelligible inputs). Human-verify: real mic unchanged.
