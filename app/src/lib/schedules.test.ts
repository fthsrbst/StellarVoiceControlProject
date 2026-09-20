import assert from "node:assert/strict";
import { test } from "node:test";

import { schedule } from "@polaris/stellar";
import type { Intent } from "@polaris/interfaces";

import {
  buildScheduleForm,
  cancelRequestFromIntent,
  disambiguateCancel,
  draftFromIntent,
  formatDuration,
  keeperStatus,
  previewFirstRun,
  summarizeScheduleHealth,
  toScheduleRows,
  type ScheduleForm,
} from "./schedules.ts";

function upcoming(over: Partial<schedule.UpcomingPayment> = {}): schedule.UpcomingPayment {
  return {
    id: 1,
    recipientAlias: "acc2",
    recipientAddress: "GACC2",
    asset: "XLM",
    amountRaw: "50000000",
    amount: "5",
    nextRunUtc: "2026-09-25T07:00:00.000Z",
    nextRunLocal: "2026-09-25T10:00:00+03:00",
    runsLeft: 8,
    intervalWords: "every week",
    status: "scheduled",
    ...over,
  };
}

function candidate(id: number, over: Partial<schedule.ScheduleCandidate> = {}): schedule.ScheduleCandidate {
  return {
    id,
    recipientAlias: "acc2",
    recipientAddress: "GACC2",
    asset: "XLM",
    amountRaw: "50000000",
    amount: "5",
    nextRunUtc: "2026-09-25T07:00:00.000Z",
    intervalWords: "every week",
    runsLeft: 8,
    ...over,
  };
}

test("toScheduleRows maps the view model and the status label", () => {
  const [row] = toScheduleRows([upcoming(), upcoming({ id: 2, status: "delayed", recipientAlias: null })]);
  assert.equal(row?.recipient, "acc2");
  assert.equal(row?.recurrence, "every week");
  assert.equal(row?.statusLabel, "Scheduled");
  const second = toScheduleRows([upcoming({ id: 2, status: "delayed", recipientAlias: null })])[0];
  assert.equal(second?.recipient, "GACC2");
  assert.match(second?.statusLabel ?? "", /keeper/);
});

test("formatDuration reads compactly and clamps to 'due now'", () => {
  assert.equal(formatDuration(-5), "due now");
  assert.equal(formatDuration(45), "in 45 s");
  assert.equal(formatDuration(125), "in 2 min");
  assert.equal(formatDuration(3 * 3600 + 5 * 60), "in 3 h 5 min");
  assert.equal(formatDuration(2 * 86_400 + 3600), "in 2 d 1 h");
});

test("keeperStatus: needed only when schedules exist, and names the next run", () => {
  const idle = keeperStatus({ hasSchedules: false, nextDueSeconds: null, nowSeconds: 0 });
  assert.equal(idle.needed, false);
  assert.match(idle.command, /npm run keeper/);

  const busy = keeperStatus({ hasSchedules: true, nextDueSeconds: 100, nowSeconds: 40 });
  assert.equal(busy.needed, true);
  assert.match(busy.headline, /next in 1 min/);
});

function form(over: Partial<ScheduleForm> = {}): ScheduleForm {
  return {
    recipient: "acc2",
    amount: "5",
    asset: "XLM",
    date: "2026-09-25",
    time: "10:00",
    timeZone: "Europe/Istanbul",
    repeat: "none",
    runs: "",
    ...over,
  };
}

test("buildScheduleForm: a one-shot builds the draft and the intent with the explicit zone", () => {
  const built = buildScheduleForm(form());
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.draft.repeat, undefined);
  assert.equal(built.draft.firstRun.timeZone, "Europe/Istanbul");
  assert.equal(built.intent.kind, "schedule_payment");
  assert.equal(built.intent.amount, "5");
});

test("buildScheduleForm: a weekly repeat carries the run count", () => {
  const built = buildScheduleForm(form({ repeat: "week", runs: "8" }));
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.deepEqual(built.draft.repeat, { every: "week" });
  assert.equal(built.draft.runs, 8);
});

test("buildScheduleForm: a repeat without a count and a bad amount are refused", () => {
  assert.equal(buildScheduleForm(form({ repeat: "day", runs: "" })).ok, false);
  assert.equal(buildScheduleForm(form({ amount: "0" })).ok, false);
  assert.equal(buildScheduleForm(form({ recipient: "  " })).ok, false);
});

test("previewFirstRun converts local to UTC and flags a DST fall-back overlap", () => {
  const normal = previewFirstRun({ localDate: "2026-09-25", localTime: "10:00", timeZone: "Europe/Istanbul" });
  assert.equal(normal.ok, true);
  if (!normal.ok) return;
  assert.equal(normal.utcIso, "2026-09-25T07:00:00.000Z");
  assert.equal(normal.ambiguous, false);

  // Berlin falls back on 2026-10-25: 02:30 happens twice.
  const overlap = previewFirstRun({ localDate: "2026-10-25", localTime: "02:30", timeZone: "Europe/Berlin" });
  assert.equal(overlap.ok, true);
  if (!overlap.ok) return;
  assert.equal(overlap.ambiguous, true);
  assert.equal(overlap.utcIso, "2026-10-25T00:30:00.000Z");
});

test("previewFirstRun refuses a DST spring-forward gap as a plain error, not a throw", () => {
  // Berlin jumps 02:00 -> 03:00 on 2026-03-29: 02:30 does not exist.
  const gap = previewFirstRun({ localDate: "2026-03-29", localTime: "02:30", timeZone: "Europe/Berlin" });
  assert.equal(gap.ok, false);
  if (gap.ok) return;
  assert.match(gap.error, /does not exist/);
});

test("cancel disambiguation: one match resolves, several ask which, none says empty", () => {
  assert.deepEqual(disambiguateCancel([]), { kind: "none" });
  const one = disambiguateCancel([candidate(3)]);
  assert.equal(one.kind, "one");

  const many = disambiguateCancel([candidate(3), candidate(9)]);
  assert.equal(many.kind, "ask");
  if (many.kind !== "ask") return;
  assert.match(many.question, /#3/);
  assert.match(many.question, /#9/);
  assert.equal(many.candidates.length, 2);
});

test("cancel disambiguation: an explicit id short-circuits ambiguity", () => {
  const exact = disambiguateCancel([candidate(3), candidate(9)], 9);
  assert.equal(exact.kind, "one");
  if (exact.kind === "one") assert.equal(exact.candidate.id, 9);
  assert.deepEqual(disambiguateCancel([candidate(3), candidate(9)], 42), { kind: "none" });
});

test("draftFromIntent and cancelRequestFromIntent round-trip a validated Intent", () => {
  const scheduleIntent: Intent = {
    kind: "schedule_payment",
    asset: "XLM",
    amount: "5",
    recipient: "acc2",
    firstRun: { localDate: "2026-09-25", localTime: "10:00", timeZone: "Europe/Istanbul" },
    repeat: { every: "week" },
    runs: 8,
  };
  const draft = draftFromIntent(scheduleIntent);
  assert.equal(draft.recipient, "acc2");
  assert.equal(draft.runs, 8);

  const cancelIntent: Intent = { kind: "cancel_schedule", asset: "", amount: "", scheduleId: 7 };
  assert.deepEqual(cancelRequestFromIntent(cancelIntent), { id: 7 });
});

test("summarizeScheduleHealth reports the worst finding in one line", () => {
  const base = {
    config: true,
    ownerConfigured: true,
    guardConfigured: true,
    listError: null,
    scheduleCount: 2,
    rulePresent: true,
    allowanceRaw: "1000000000",
  };
  assert.equal(summarizeScheduleHealth(base).status, "ok");
  assert.match(summarizeScheduleHealth({ ...base, config: false }).detail, /stellar_config/);
  assert.equal(summarizeScheduleHealth({ ...base, listError: "boom" }).status, "fail");
  assert.match(summarizeScheduleHealth({ ...base, rulePresent: false }).detail, /guard rule/);
  assert.equal(summarizeScheduleHealth({ ...base, allowanceRaw: "0" }).status, "warn");
});
