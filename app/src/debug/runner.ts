/**
 * Check runner (step W0b).
 *
 * Pure and Tauri-free: the Debug panel passes it the checks the registry
 * collected, and it guarantees three things no individual check should have to:
 *
 * * a **timeout** (5 s by default) so a hung command cannot freeze the panel;
 * * a thrown error becomes a `fail` result with a one-line detail, never an
 *   unhandled rejection;
 * * one failing check cannot stop the others, whether they run alone or in the
 *   bounded-concurrency [`runAll`].
 *
 * Every returned detail is scrubbed by [`redact`] and every field is normalised,
 * so a malformed check cannot put a secret or a `undefined` on screen.
 */
import { redact } from "./redact.ts";
import type { CheckResult, CheckStatus, FeatureCheck } from "./types.ts";

/** Default per-check budget. A live command should answer well under this. */
export const DEFAULT_TIMEOUT_MS = 5_000;

/** Default `runAll` parallelism: a small bound so the panel stays responsive. */
export const DEFAULT_CONCURRENCY = 4;

const NO_DETAIL = "the check returned no detail";

/** Structural guard for a check's status, used when normalising a result. */
export function isCheckStatus(value: unknown): value is CheckStatus {
  return value === "ok" || value === "warn" || value === "fail" || value === "unknown";
}

/** One line about a thrown value, safe to show a non-developer. */
export function errorDetail(error: unknown): string {
  const raw =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const line = raw.split("\n")[0]?.trim() ?? "";
  return line.length > 0 ? line : "the check failed without a message";
}

/** Builds a result with a scrubbed detail. The single exit for every path. */
export function makeResult(
  status: CheckStatus,
  detail: string,
  checkedAt = Date.now(),
): CheckResult {
  const scrubbed = redact(detail).trim();
  return { status, detail: scrubbed.length > 0 ? scrubbed : NO_DETAIL, checkedAt };
}

/** Coerces whatever a check returned into a valid, scrubbed result. */
function normalize(candidate: unknown): CheckResult {
  const value = (
    typeof candidate === "object" && candidate !== null ? candidate : {}
  ) as Partial<CheckResult>;
  const status = isCheckStatus(value.status) ? value.status : "fail";
  const detail =
    typeof value.detail === "string" && value.detail.trim().length > 0
      ? value.detail
      : NO_DETAIL;
  const checkedAt =
    typeof value.checkedAt === "number" && Number.isFinite(value.checkedAt)
      ? value.checkedAt
      : Date.now();
  return makeResult(status, detail, checkedAt);
}

/**
 * Runs one check under a timeout. A throw, a rejection, a timeout or a malformed
 * result all become a `fail` result; the function itself never rejects.
 */
export async function runCheck(
  check: FeatureCheck,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<CheckResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<CheckResult>((resolve) => {
    timer = setTimeout(
      () => resolve(makeResult("fail", `the check timed out after ${timeoutMs} ms`)),
      timeoutMs,
    );
  });

  // `Promise.resolve().then` converts a synchronous throw in `check.run` into a
  // rejection the `catch` below can handle.
  const checkPromise = Promise.resolve().then(() => check.run());
  // If the timeout wins, the check may still reject later; swallow it so it
  // cannot surface as an unhandled rejection.
  checkPromise.catch(() => {});

  try {
    return normalize(await Promise.race([checkPromise, timeout]));
  } catch (error) {
    return makeResult("fail", errorDetail(error));
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** A check paired with its latest result, in registry order. */
export interface CheckRun {
  check: FeatureCheck;
  result: CheckResult;
}

/** Options for [`runAll`]. */
export interface RunAllOptions {
  concurrency?: number;
  timeoutMs?: number;
}

/**
 * Runs every check with bounded concurrency and returns their results in the
 * input order, so the panel's list never reorders while results stream in.
 */
export async function runAll(
  checks: readonly FeatureCheck[],
  options: RunAllOptions = {},
): Promise<CheckRun[]> {
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? DEFAULT_CONCURRENCY));
  const results = new Array<CheckRun>(checks.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= checks.length) return;
      const check = checks[index];
      if (!check) return;
      results[index] = {
        check,
        result: await runCheck(check, options.timeoutMs),
      };
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, checks.length) }, () => worker()),
  );
  return results;
}
