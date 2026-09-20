/**
 * Pure schedule logic for the Schedules panel and the voice path (W6b).
 *
 * Everything here is free of React and Tauri so it runs under `node --test`:
 * the "Upcoming payments" view model, the keeper status strip, the New-schedule
 * form validation (which also builds the shared `ScheduleDraft` **and** the
 * `Intent`), the local+UTC time preview, and cancel disambiguation.
 *
 * The live wiring (RPC, guard client, allowance reader) is in
 * `@/lib/schedulesLive`; this module imports only the pure `@polaris/stellar`
 * schedule/time helpers.
 */
import { schedule } from "@polaris/stellar";
import type { Intent } from "@polaris/interfaces";

/** The exact command the keeper status strip tells the user to run. */
export const KEEPER_COMMAND = "caffeinate -i npm run keeper -w @polaris/stellar";

/** Keeper poll interval the contract/client assume (seconds). */
export const DEFAULT_POLL_SECONDS = 15;

/** The device's IANA zone, with a UTC fallback when `Intl` cannot report one. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/* ------------------------------------------------------------------ *
 * View model
 * ------------------------------------------------------------------ */

/** Human label for each `listUpcoming` status. */
export const STATUS_LABELS: Record<schedule.UpcomingPayment["status"], string> = {
  scheduled: "Scheduled",
  due: "Due now",
  delayed: "Delayed — keeper may be offline",
  finished: "Finished",
};

/** One row of the panel's list, with the fields the UI renders. */
export interface ScheduleRow {
  id: number;
  recipient: string;
  recipientAddress: string;
  amount: string;
  asset: string;
  /** Next run in the requested zone, e.g. `2026-09-25T10:00:00+03:00`. */
  nextRunLocal: string;
  /** Next run in UTC, e.g. `2026-09-25T07:00:00.000Z`. */
  nextRunUtc: string;
  recurrence: string;
  runsLeft: number;
  status: schedule.UpcomingPayment["status"];
  statusLabel: string;
}

/** Maps `listUpcoming` view models to the panel's rows (no chain access). */
export function toScheduleRows(rows: readonly schedule.UpcomingPayment[]): ScheduleRow[] {
  return rows.map((row) => ({
    id: row.id,
    recipient: row.recipientAlias ?? row.recipientAddress,
    recipientAddress: row.recipientAddress,
    amount: row.amount,
    asset: row.asset,
    nextRunLocal: row.nextRunLocal,
    nextRunUtc: row.nextRunUtc,
    recurrence: row.intervalWords,
    runsLeft: row.runsLeft,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status],
  }));
}

/* ------------------------------------------------------------------ *
 * Keeper status
 * ------------------------------------------------------------------ */

export interface KeeperStatus {
  /** True when at least one schedule exists and therefore needs a keeper. */
  needed: boolean;
  /** One short line for the strip. */
  headline: string;
  /** The command to start one; the UI never runs it. */
  command: string;
}

/** Seconds -> a compact "in 2 h 5 min" / "due now" phrase. */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "due now";
  const total = Math.floor(seconds);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `in ${days} d ${hours} h`;
  if (hours > 0) return `in ${hours} h ${minutes} min`;
  if (minutes > 0) return `in ${minutes} min`;
  return `in ${total} s`;
}

/**
 * Plain status for the keeper strip: whether a keeper is needed, how soon the
 * next run is, and how to start one. **Never starts a process.** The UI only
 * renders `command` for the user to copy.
 */
export function keeperStatus(input: {
  hasSchedules: boolean;
  /** Seconds until the next run (negative/0 = already due), or `null` if none. */
  nextDueSeconds: number | null;
  nowSeconds: number;
  pollSeconds?: number;
}): KeeperStatus {
  const command = KEEPER_COMMAND;
  if (!input.hasSchedules) {
    return { needed: false, headline: "No schedules yet — a keeper is not needed.", command };
  }
  const poll = input.pollSeconds ?? DEFAULT_POLL_SECONDS;
  const eta =
    input.nextDueSeconds === null
      ? "no upcoming run"
      : formatDuration(input.nextDueSeconds - input.nowSeconds);
  return {
    needed: true,
    headline: `A keeper must be running to settle schedules — next ${eta} (runs ~${poll}–25 s late).`,
    command,
  };
}

/* ------------------------------------------------------------------ *
 * Local + UTC time preview
 * ------------------------------------------------------------------ */

export type TimePreview =
  | { ok: true; epochSeconds: number; localIso: string; utcIso: string; ambiguous: boolean }
  | { ok: false; error: string };

/**
 * Resolves a wall-clock first run to the UTC instant the chain stores, using the
 * explicit IANA zone. Returns a result object instead of throwing so a form can
 * show the error inline. DST gaps are refused by the helper; a fall-back overlap
 * is accepted with `ambiguous: true` (the earlier instant) and shown as a hint.
 */
export function previewFirstRun(input: {
  localDate: string;
  localTime: string;
  timeZone: string;
  now?: Date;
}): TimePreview {
  try {
    const resolved = schedule.resolveLocalTime({
      localDate: input.localDate,
      localTime: input.localTime,
      timeZone: input.timeZone,
      ...(input.now ? { now: input.now } : {}),
    });
    return {
      ok: true,
      epochSeconds: resolved.epochSeconds,
      localIso: resolved.localIso,
      utcIso: resolved.utcIso,
      ambiguous: resolved.ambiguous,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/* ------------------------------------------------------------------ *
 * New schedule form
 * ------------------------------------------------------------------ */

export type RepeatChoice = "none" | "day" | "week";

export type ScheduleAsset = "USDC" | "XLM";

export interface ScheduleForm {
  recipient: string;
  amount: string;
  asset: ScheduleAsset;
  /** `YYYY-MM-DD`. */
  date: string;
  /** `HH:mm`. */
  time: string;
  timeZone: string;
  repeat: RepeatChoice;
  /** Free text run count; required for a repeat. */
  runs: string;
}

export type FormResult =
  | { ok: true; draft: schedule.ScheduleDraft; intent: Intent }
  | { ok: false; error: string };

const AMOUNT_RE = /^\d{1,12}(\.\d{1,7})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/**
 * Validates the New-schedule form and builds both the chain `ScheduleDraft` and
 * the shared `Intent` (so the approval card's meta and the chain tool agree).
 * Pure: no network. The amount and time are re-checked by the chain tool.
 */
export function buildScheduleForm(form: ScheduleForm): FormResult {
  const recipient = form.recipient.trim();
  if (recipient.length === 0) return { ok: false, error: "Enter a recipient alias." };
  const amount = form.amount.trim();
  if (!AMOUNT_RE.test(amount) || !/[1-9]/.test(amount)) {
    return { ok: false, error: "Enter a positive amount (up to 7 decimals)." };
  }
  if (!DATE_RE.test(form.date)) return { ok: false, error: "Pick the first run date." };
  if (!TIME_RE.test(form.time)) return { ok: false, error: "Pick the first run time (24-hour)." };

  let runs: number | undefined;
  if (form.repeat !== "none") {
    if (!/^\d+$/.test(form.runs.trim())) {
      return { ok: false, error: "A repeating schedule needs a run count." };
    }
    runs = Number(form.runs.trim());
    if (!Number.isInteger(runs) || runs < 1) {
      return { ok: false, error: "The run count must be a whole number of at least 1." };
    }
  }

  const firstRun = { localDate: form.date, localTime: form.time, timeZone: form.timeZone };
  const draft: schedule.ScheduleDraft = {
    recipient,
    asset: form.asset,
    amount,
    firstRun,
    ...(form.repeat === "none" ? {} : { repeat: { every: form.repeat } }),
    ...(runs !== undefined ? { runs } : {}),
  };
  const intent: Intent = {
    kind: "schedule_payment",
    asset: form.asset,
    amount,
    recipient,
    firstRun,
    ...(form.repeat === "none" ? {} : { repeat: { every: form.repeat } }),
    ...(runs !== undefined ? { runs } : {}),
  };
  return { ok: true, draft, intent };
}

/* ------------------------------------------------------------------ *
 * Intent -> chain tool input (voice path)
 * ------------------------------------------------------------------ */

/** Builds the chain `ScheduleDraft` from a validated `schedule_payment` Intent. */
export function draftFromIntent(intent: Intent): schedule.ScheduleDraft {
  if (intent.kind !== "schedule_payment") {
    throw new Error(`expected a schedule_payment intent, got "${intent.kind}"`);
  }
  if (!intent.recipient || !intent.firstRun) {
    throw new Error("schedule_payment intent is missing its recipient or first run");
  }
  if (intent.asset !== "USDC" && intent.asset !== "XLM") {
    throw new Error(`scheduled payments support USDC and XLM only, got "${intent.asset}"`);
  }
  return {
    recipient: intent.recipient,
    asset: intent.asset,
    amount: intent.amount,
    firstRun: intent.firstRun,
    ...(intent.repeat ? { repeat: intent.repeat } : {}),
    ...(intent.runs !== undefined ? { runs: intent.runs } : {}),
  };
}

/** Builds the `cancel_schedule` request from a validated `cancel_schedule` Intent. */
export function cancelRequestFromIntent(intent: Intent): {
  id?: number;
  recipient?: string;
  which?: "last" | "next";
} {
  if (intent.kind !== "cancel_schedule") {
    throw new Error(`expected a cancel_schedule intent, got "${intent.kind}"`);
  }
  return {
    ...(intent.scheduleId !== undefined ? { id: intent.scheduleId } : {}),
    ...(intent.recipient ? { recipient: intent.recipient } : {}),
    ...(intent.which ? { which: intent.which } : {}),
  };
}

/* ------------------------------------------------------------------ *
 * Cancel disambiguation
 * ------------------------------------------------------------------ */

export type CancelResolution =
  | { kind: "one"; candidate: schedule.ScheduleCandidate }
  | { kind: "ask"; question: string; candidates: schedule.ScheduleCandidate[] }
  | { kind: "none" };

/* ------------------------------------------------------------------ *
 * Debug health
 * ------------------------------------------------------------------ */

/** Live facts the schedules Debug check gathers (all reads, no writes). */
export interface ScheduleHealthFacts {
  /** `stellar_config` was readable. */
  config: boolean;
  ownerConfigured: boolean;
  guardConfigured: boolean;
  /** Human error from reading the schedule list, or `null` when it worked. */
  listError: string | null;
  /** Active schedules the owner has. */
  scheduleCount: number;
  /** Whether the owner has a published guard rule. */
  rulePresent: boolean;
  /** SAC allowance in raw units as a decimal string, or `null` when unreadable. */
  allowanceRaw: string | null;
}

/**
 * Maps schedule facts to one Debug result line. Severity is the worst finding:
 * a missing command/owner/guard is `warn`; an unreadable list is `fail`; a
 * missing rule or allowance is `warn` with what to do (schedule runs settle
 * through `transfer_from`, so both are required); otherwise `ok` with a count.
 */
export function summarizeScheduleHealth(facts: ScheduleHealthFacts): {
  status: "ok" | "warn" | "fail" | "unknown";
  detail: string;
} {
  if (!facts.config) return { status: "warn", detail: "stellar_config is not present on this build" };
  if (!facts.ownerConfigured) {
    return { status: "warn", detail: "POLARIS_OWNER_ADDRESS is not set; schedules are disabled" };
  }
  if (!facts.guardConfigured) {
    return { status: "warn", detail: "GUARD_CONTRACT_ID is not set; schedules cannot be read or created" };
  }
  if (facts.listError !== null) {
    return { status: "fail", detail: `could not read schedules: ${facts.listError}` };
  }
  if (!facts.rulePresent) {
    return {
      status: "warn",
      detail: "no guard rule is published; schedules settle through transfer_from and will fail",
    };
  }
  if (facts.allowanceRaw === null) {
    return { status: "warn", detail: "the SAC allowance could not be read; schedule runs may fail" };
  }
  if (BigInt(facts.allowanceRaw) === 0n) {
    return {
      status: "warn",
      detail: "the SAC allowance is 0; schedule runs will fail until the owner approves the guard",
    };
  }
  return { status: "ok", detail: `${facts.scheduleCount} active schedule(s); allowance covers runs` };
}

/**
 * Decides what a cancel request means given the recipient's active schedules.
 * One match resolves to it; several produce an "ask which" question (the agent
 * never guesses); none means there is nothing to cancel. `requestedId` short-
 * circuits the ambiguity when the user named an exact schedule.
 */
export function disambiguateCancel(
  candidates: readonly schedule.ScheduleCandidate[],
  requestedId?: number,
): CancelResolution {
  if (requestedId !== undefined) {
    const exact = candidates.find((candidate) => candidate.id === requestedId);
    return exact ? { kind: "one", candidate: exact } : { kind: "none" };
  }
  if (candidates.length === 0) return { kind: "none" };
  if (candidates.length === 1) return { kind: "one", candidate: candidates[0] as schedule.ScheduleCandidate };
  const lines = candidates
    .map((candidate) => `#${candidate.id} — ${candidate.amount} ${candidate.asset}, ${candidate.intervalWords}`)
    .join("; ");
  return {
    kind: "ask",
    question: `More than one schedule matches. Which should I cancel? ${lines}`,
    candidates: [...candidates],
  };
}
