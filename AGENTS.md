# AGENTS.md — Project Constitution

> ⚠️ **SYNC RULE:** This file is kept strictly in sync with `CLAUDE.md`.
> EVERY change made here must also be applied to `CLAUDE.md` (and vice versa).
> The two files must never diverge in content.

> 🌐 **LANGUAGE RULE:** All project documentation, code comments, commit messages, PR descriptions, backlog reports, research reports, and notes are written in **English** — regardless of the language used in prompts/conversations. Prompts may be in Turkish; output artifacts are always English.

---

## Local notes

`LOCAL.md` (gitignored) holds user-specific information: machine setup, personal context, local paths. If it exists, read it at session start. Nothing user-specific goes into committed files.

---

## 1. Primary Model's Role: COORDINATOR

The primary model (you) **does not write code, read code, or read files** in this project. Its sole job is coordination:

- Break work into pieces and distribute to worker agents.
- Collect worker outputs, manage the review process, make merge decisions.
- Prevent conflicts between workers (file/worktree separation).
- Supervise updates to `backlog.md`, `sprints.md`, `notes.md`.

**Writing code, reading code, reading files, researching, running tests → WORKER's job.**
The primary model only writes clear, self-contained task definitions for workers.

---

## 2. Parallel Agent Architecture

- Work is generally done with **parallel agents** in this project.
- Each worker operates in **its own git worktree**. Two agents never work in the same worktree → nobody blocks anybody.
- When a worker finishes, it opens a **PR** from its own branch. Merges happen only via PR + review.
- When launching parallel work, the primary model assigns each worker a non-overlapping file scope.

### Worktree Rule
```bash
# For every new parallel task:
git worktree add .worktrees/<task-name> -b <branch-name>
# The worker operates only in this directory.
# After the PR is merged, the worktree is cleaned up:
git worktree remove .worktrees/<task-name>
```

### Remote Structure (Single Repo)
- **origin** = `n0tnow/StellarVoiceControlProject` — the shared main repo. All branches, worktrees, and PRs live here.
- **fork** = `fthsrbst/StellarVoiceControlProject` — personal backup/showcase; not used in active development, synced with origin occasionally.
- No PRs are opened to the fork; all PRs go from branch to main on origin.

---

## 3. Mandatory Review

**Every step involves detailed review.** Clean code = clean project.

- No PR is merged without review.
- A separate worker (reviewer) is assigned for review; the worker who wrote the code cannot review its own code.
- Review criteria: correctness, readability, tests, security, adherence to project conventions.
- The review outcome (approval/rejection + rationale) is recorded in the relevant report under `backlog/`.

---

## 4. Caffeinate Rule

- Agents use **`caffeinate`** for all long-running operations.
- Builds, tests, long scripts, long worker tasks are wrapped with `caffeinate -i`:
```bash
caffeinate -i <command>
```
- The primary model mandates caffeinate usage for long commands in task definitions given to workers.

---

## 5. Lazy Loading — Document Access Map

To avoid bloating the primary model's context, details are kept in separate files.
**Agents read the relevant file only when needed; nothing is preloaded.**

| File | When to read |
|---|---|
| `notes.md` | When idea/discussion history is needed; when adding a new idea |
| `backlog.md` + `backlog/` | When querying unfinished work; when filing worker reports |
| `docs/reports/` | When research/archive information is needed (searchable) |
| `docs/model-ladder.md` (local-only, never committed) | When selecting a worker — **read before every task assignment** (if present on disk) |
| `sprints.md` | Milestone/checklist tracking; task prioritization |

> ✅ All important rules live in this file (AGENTS.md). Other files carry details/data, not rules.

---

## 6. Documentation Duties (For Every Agent)

- **No idea is lost:** Every discussed idea is recorded in `notes.md` as a dated note.
- **No task is dropped:** Every unfinished task is documented by the worker/sub-agent in a `backlog/<task>.md` report and added to the `backlog.md` index.
- **Every research effort is archived:** Research outputs are placed under `docs/reports/` as dated files and registered in `docs/reports/INDEX.md`.
- When finishing, a worker always returns: status report + remaining work + the PR link opened.
- **README is refreshed every milestone:** At the end of each milestone, a dedicated agent updates `README.md` to reflect the current codebase (what it does, architecture, setup, usage). README is never left stale.

---

## 7. Git & GitHub Discipline

- **Commits are made continuously:** Every meaningful small change is its own commit. No giant single commits; atomic, descriptive commit messages (conventional commits recommended: `feat:`, `fix:`, `docs:`, `refactor:`).
- **Pushes happen regularly:** Worker branches are pushed frequently; work never stays local only.
- **Docs are kept continuously up to date:** In every PR that changes code, the related `.md` files are also updated (notes/backlog/sprints/reports). Documentation updates are part of the PR, not "work for later."
- **Parallel agents may be spawned for documentation:** We have no sub-agent constraints. After a main round finishes, spawning a **parallel documentation agent** for that round's doc updates (notes.md, backlog reports, docs/reports/ archive, sprints.md checklist) is encouraged — the main flow is not blocked.
- **GitHub is used actively:** PR descriptions are written in full (what/why/how tested), linked to issues when they exist, and review comments happen on the PR.

---

## 8. Communication & Task Format

Every task given to a worker includes:
1. **Objective** — what and why
2. **Scope** — which files/directories (touch nothing else)
3. **Worktree/branch name**
4. **Acceptance criteria** — how it will be tested
5. **Report format** — where the backlog report will be written

## 9. Versioning & Commit Cadence

### Semantic versioning (code)
- When code lands: add a root `VERSION` file + `CHANGELOG.md`; tag each release `vMAJOR.MINOR.PATCH` (SemVer).
- Pre-1.0 policy: `v0.x.y` — bump MINOR for features, PATCH for fixes, once per milestone. The coordinator cuts tags after merge; agents never tag.

### Commit cadence (agents)
- **Commit after every completed logical step** (atomic, single-topic) — never on a timer or fixed interval. One logical change = one commit.
- **Push at the end of every task/session** — work never stays local-only, even if unfinished (push the branch, not `main`).
- **`main` is PR-only:** no direct commits to `main`. Merge = PR (squash) + review, per the async review workflow.

### `main` sync (agents)
- **Pull/rebase at task start:** every agent runs `git pull origin main` (and rebases its branch onto `main`) before starting any work.
- Agents on separate clones / separate machines follow the exact same rule; work is never shared by manual file copying.

### When real-time coordination IS required
Routine commits/pushes/PRs need **no** face-to-face or chat coordination — the PR is the async channel. Notify the other person (face-to-face or DM) only for:
1. **Scope change** — work outside the assigned file scope,
2. **Merge conflicts** — deciding which side wins,
3. **Milestone completion** — version tag + README refresh,
4. **Touching files** another agent/person is actively working on.

### Local-only files
- `.gitignore`-d files (`LOCAL.md`, `docs/model-ladder.md`, …) are never committed; every clone keeps its own copy.
- `.gitignore` itself must stay **identical across all clones** — a differing `.gitignore` is a bug, fix it via PR.

---

*Last updated: 2026-09-19*
