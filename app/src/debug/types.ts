/**
 * Debug-panel check contract (step W0b).
 *
 * A **FeatureCheck** is the one-file plug point every later milestone uses to
 * make a feature say "this is working right now" (or why not). The Debug panel
 * auto-collects `checks/*.ts` (`registry.ts`), runs them and renders the
 * results; nothing else has to change when a feature adds one.
 *
 * The shape mirrors the Rust `FeatureHealth` described in the project's Debug
 * contract: `{ id, title, milestone, status, detail, checkedAt }` with
 * camel-cased fields. Keep this file type-only — it is imported by pure modules
 * that run under `node:test` (`docs/debug-panel.md`).
 */

/** How a check's last run ended. */
export type CheckStatus = "ok" | "warn" | "fail" | "unknown";

/** Milestone tag shown on the badge, e.g. `"W0"`, `"W3"`. */
export type Milestone = `W${number}`;

/** The outcome of running one check (or one action). */
export interface CheckResult {
  /**
   * `ok` = verified live just now; `warn` = configured/degraded but not fully
   * verified; `fail` = broken (the detail says why, in one actionable sentence);
   * `unknown` = not run yet.
   */
  status: CheckStatus;
  /** One line a non-developer can act on. Never a secret (`redact.ts`). */
  detail: string;
  /** When the result was produced, in milliseconds since the epoch. */
  checkedAt: number;
}

/**
 * An explicit, user-triggered self-test with a side effect the user notices
 * (for example showing the Touch ID prompt). Actions are **never** run by
 * `runAll` or on panel open; the Debug panel only offers them as buttons.
 */
export interface CheckAction {
  id: string;
  label: string;
  description: string;
  run(): Promise<CheckResult>;
}

/** One feature's "is it working?" check. */
export interface FeatureCheck {
  id: string;
  title: string;
  milestone: Milestone;
  /** Non-destructive: must never move funds or prompt the user. */
  run(): Promise<CheckResult>;
  /** Optional side-effecting self-tests, shown as secondary buttons. */
  actions?: CheckAction[];
}
