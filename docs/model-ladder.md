# Model Ladder — Worker Ranking & Usage Methods

> This file defines **which worker the coordinator selects** when assigning tasks.
> The coordinator reads this file before every task assignment (lazy loading).
> Model names are updated per environment; the logic is fixed: **use the lowest sufficient level for the task's difficulty.**
> This document is written in **English** like all project documentation.

---

## The Ladder (top to bottom)

| Level | Role | Typical Model Class | Usage |
|---|---|---|---|
| L0 | Coordinator (primary model) | Strongest model | Coordination only; does NOT read/write code or files |
| L1 | Senior Worker | Strong model | Architecture decisions, complex implementation, hard debugging, PR review (critical) |
| L2 | Mid Worker | Medium model | Standard feature development, test writing, refactoring, documentation |
| L3 | Junior Worker | Light/fast model | Simple file operations, formatting, grep/search, report compilation, boilerplate |
| L4 | Reviewer | L1/L2 depending on task criticality | PR review; can NEVER be the same agent as the code author |

---

## Usage Methods

### 1. Task → Level Mapping
- Take the task → classify difficulty (trivial / standard / complex) → select the **lowest sufficient level**.
- Don't burn an expensive model on trivial work; don't risk critical work on a light model.

### 2. Parallel Assignment
- Independent tasks are assigned simultaneously to different workers in different worktrees.
- Two tasks touching the same file scope are never parallelized (they are queued).

### 3. Escalation
- If a worker gets stuck or cannot finish: it files its report under `backlog/` → the coordinator escalates the task one level up.
- Escalation chain: L3 → L2 → L1. If L1 cannot solve it, the coordinator consults the user.

### 4. Review Pairing
- Critical module PR → L1 reviewer. Standard PR → L2 reviewer.
- Reviewer and author are never the same worktree/agent.

### 5. Sub-Agent Reporting
- Workers/sub-agents at every level write their reports to the `backlog/` directory upon task completion (template: `backlog.md`).

---

## Model Assignment Table (filled per environment)

| Level | Model to Use | Notes |
|---|---|---|
| L0 | (primary model — this session) | Coordinator |
| L1 | <to be filled> | |
| L2 | <to be filled> | |
| L3 | <to be filled> | |
| L4 | <to be filled> | |

> This table is updated once the models available in the environment are finalized.
