/**
 * Check registry (step W0b).
 *
 * The Debug panel's list is built from `app/src/debug/checks/*.ts`: any module
 * that default-exports a [`FeatureCheck`] is picked up automatically, so a later
 * milestone adds exactly one file and touches nothing else. A module that does
 * not (a stray helper, a typo) becomes a visible `fail` entry instead of taking
 * the panel down.
 *
 * The glob lives inside [`loadChecks`], not at module scope, so the pure
 * [`collectChecks`] can be unit-tested under `node:test` with an injected module
 * map (`docs/debug-panel.md`).
 */
import type { FeatureCheck, Milestone } from "./types.ts";

/** Milestone a malformed module is tagged with; it has no declared one. */
const MALFORMED_MILESTONE: Milestone = "W0";

/** The last path segment, used to name a malformed module without its directory. */
function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

/** Numeric rank of a `W<n>` tag, so `W10` sorts after `W3` (unlike string order). */
function milestoneRank(milestone: string): number {
  const digits = /^W(\d+)$/.exec(milestone)?.[1];
  return digits ? Number(digits) : Number.MAX_SAFE_INTEGER;
}

/** Registry order: by milestone, then by id. Deterministic across builds. */
export function compareChecks(a: FeatureCheck, b: FeatureCheck): number {
  return milestoneRank(a.milestone) - milestoneRank(b.milestone) || a.id.localeCompare(b.id);
}

/** A module with no usable default export, surfaced as a failing check. */
function malformedCheck(path: string): FeatureCheck {
  const name = fileName(path);
  return {
    id: `malformed:${path}`,
    title: `Malformed check module: ${name}`,
    milestone: MALFORMED_MILESTONE,
    async run() {
      return {
        status: "fail",
        detail: `${name} does not default-export a FeatureCheck`,
        checkedAt: Date.now(),
      };
    },
  };
}

/** True when `value` has the minimum shape of a [`FeatureCheck`]. */
function isFeatureCheck(value: unknown): value is FeatureCheck {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<FeatureCheck>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.milestone === "string" &&
    typeof candidate.run === "function"
  );
}

/**
 * Builds the ordered check list from an eager module map. Injected so tests can
 * exercise ordering and malformed-module tolerance without a bundler.
 */
export function collectChecks(modules: Record<string, unknown>): FeatureCheck[] {
  const checks: FeatureCheck[] = [];
  for (const [path, loaded] of Object.entries(modules)) {
    const candidate = (loaded as { default?: unknown } | null | undefined)?.default;
    checks.push(isFeatureCheck(candidate) ? candidate : malformedCheck(path));
  }
  return checks.sort(compareChecks);
}

/**
 * The checks this build ships. Vite replaces the glob with the eager imports of
 * `checks/*.ts`; calling this under plain `node` would fail, which is why the
 * tests only call [`collectChecks`].
 */
export function loadChecks(): FeatureCheck[] {
  return collectChecks(import.meta.glob("./checks/*.ts", { eager: true }));
}
