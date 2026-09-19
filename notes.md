# notes.md — Idea & Discussion Notes

> This file is the project's memory. **Every idea** that comes up and **every discussion** held is recorded here as a dated note.
> **No note, idea, or decision is ever forgotten or deleted.** If a decision changes, an update is appended below the old note without striking it through.
> All notes are written in **English**, regardless of the conversation language.
>
> Format:
> ```
> ## YYYY-MM-DD — <Topic Title>
> - **Idea:** ...
> - **Discussion:** ...
> - **Decision:** (if any) ...
> - **Status:** [open | decided | shelved]
> ```

---

## 2026-09-19 — Project Bootstrap
- **Idea:** Project infrastructure set up: CLAUDE.md/AGENTS.md constitution, backlog system, report archive, model ladder, sprint tracking.
- **Decision:** Primary model acts as coordinator; all execution happens in parallel workers. Worktree + PR + mandatory review. Caffeinate for all long-running operations.
- **Decision:** Single-repo model — origin = `n0tnow/StellarVoiceControlProject` (shared repo), fork = personal backup only.
- **Decision:** All documentation is written in English, even when prompts/conversations are in Turkish.
- **Note:** Project topic, architecture, and technical research are being handled by another team member; results will land in `docs/reports/`.
- **Status:** decided

## 2026-09-19 — Architecture Decision (Polaris)
- **Idea:** Desktop app architecture for the Stellar Pro Hackathon (Genesis track, deadline 20 Sep 12:00).
- **Decision:** Full decision recorded in `docs/architecture.md` (registered in `docs/reports/INDEX.md`). Tauri v2 shell with thin Rust core (hotkey, audio/screen capture, Keychain + Touch ID custody) + TypeScript/React (Vite, Tailwind, shadcn/ui) webview; decision is spike-gated with Electron fallback. Soroban contract `polaris_guard` enforces spending policy on testnet.
- **Status:** decided

<!-- New notes are appended chronologically at the bottom. -->
