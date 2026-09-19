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

## 2026-09-19 — Owner A UX Vision: Notch Companion UI
- **Idea:** Polaris lives in the MacBook notch as an always-present companion. Six core UX features (Owner A's part; reference screenshots provided, visually similar to "HeyClickey"-style notch assistants):
  1. **Idle notch pill:** A black, rounded, pixel-perfect area flush with the notch, always visible even in idle state. (Ref: plain black bar hugging the notch.)
  2. **Hold-to-talk hotkey (Ctrl+Option):** While held, the assistant listens; the notch area expands horizontally (left + right) with an animated state. A short status label is shown — e.g. `Listening`, `Thinking`, `Sending`, `Speaking` — with a small animated indicator (Ref: "Thinking" state with purple gradient + pulsing dots; "Speaking" state with orange waveform bars).
  3. **Mouse-following caption pill:** When an operation runs, a button/pill appears next to the user's mouse cursor and smoothly follows it, showing the transcript of the spoken conversation. (Ref: green "YouTube Premium" pill.)
  4. **Companion cursor:** The AI has its OWN cursor, used to point at / highlight relevant spots on the screen. (Ties into M2 A4 — computer use / screen awareness.)
  5. **Expandable notch workspaces:** For required operations the notch can expand into larger in-notch interfaces (cards, controls). The concrete list of these interfaces is TBD — **to be discussed in a follow-up session.** (Ref: "Your Mac is muted — answer on clipboard, ⌘V to paste" card with an Unmute action button and close button.)
  6. **Text input mode (double-tap Ctrl):** Double-pressing Ctrl expands the notch into a text input field so the user can type to the AI instead of speaking. Includes mute toggle, attach (📎) and send buttons, close button. (Ref: "Ask HeyClickey…" input bar.)
- **Discussion:** These define the visual/interaction layer of the voice pipeline track (M2 A0–A5 harness UI evolves into this notch companion). Research tasks will be requested in a new session (native macOS notch window approach vs Tauri overlay, expansion animation, cursor-following window, companion cursor rendering).
- **Status:** open (concept recorded; research pending)


## 2026-09-19 — Two-Person Review & Merge Workflow (Main Branch Strategy)
- **Idea:** With only two collaborators and no capacity for continuous, synchronous code review, define a lightweight but mandatory PR review workflow for merging into `main`.
- **Discussion:** The constitution's mandatory-review rule (author never reviews own code) is satisfiable in a 2-person team: each person reviews the other's PRs. Review must be asynchronous and timeboxed rather than blocking, especially under the hackathon deadline (20 Sep 12:00). A fast-track path is needed for urgent fixes so review never becomes the bottleneck.
- **Decision:**
  1. **Async review with SLA:** Open a PR for every change; the other person reviews at fixed checkpoints (morning / evening) or within ~12 hours, whichever comes first. No real-time availability required.
  2. **Small PRs:** One logical change per PR (code + its doc updates together), so a review takes minutes, not hours. Draft PRs are opened early so the reviewer can follow along while work is in progress.
  3. **Merge style:** Squash-merge into `main` (one clean commit per PR), delete the feature branch after merge. `main` must always be green/deployable: CI passing + at least 1 approval (the other person) before merge.
  4. **Fast-track (deadline exception):** For urgent bug fixes or time-critical changes, the author may self-merge with the `review-after-merge` label + a short written risk note in the PR description; the other person reviews it post-merge within the next checkpoint. Not allowed for new features or anything touching secrets/key handling.
  5. **Trivial changes (docs, typos, comments):** May be merged without approval, but still via PR so history stays traceable.
  6. **Conflict avoidance:** As per constitution, parallel work stays in separate worktrees/branches with non-overlapping file scopes; rebase onto `main` before requesting review if the branch has drifted.
- **Status:** decided

<!-- New notes are appended chronologically at the bottom. -->
