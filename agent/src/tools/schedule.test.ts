import assert from "node:assert/strict";
import { test } from "node:test";

import { AgentError } from "../errors.ts";
import {
  normalizeRepeat,
  normalizeWhich,
  parseCancelSchedule,
  parseSchedulePayment,
} from "./schedule.ts";

const ISTANBUL = { network: "testnet" as const, transcript: "test", timeZone: "Europe/Istanbul" };

test("schedule_payment: a Turkish weekly phrase produces the schedule Intent", () => {
  const intent = parseSchedulePayment(
    {
      amount: "5",
      asset: "XLM",
      recipient: "acc2",
      firstDate: "2026-09-25",
      firstTime: "10:00",
      repeat: "her cuma",
      runs: 8,
    },
    { network: "testnet", transcript: "her cuma 10:00'da acc2'ye 5 XLM gönder", timeZone: "Europe/Istanbul" },
  );
  assert.deepEqual(intent, {
    kind: "schedule_payment",
    asset: "XLM",
    amount: "5",
    recipient: "acc2",
    firstRun: { localDate: "2026-09-25", localTime: "10:00", timeZone: "Europe/Istanbul" },
    repeat: { every: "week" },
    runs: 8,
    source: "her cuma 10:00'da acc2'ye 5 XLM gönder",
  });
});

test("schedule_payment: an English one-shot phrase resolves to no repeat", () => {
  const intent = parseSchedulePayment(
    {
      amount: "2",
      asset: "XLM",
      recipient: "acc2",
      firstDate: "2026-09-21",
      firstTime: "15:00",
    },
    { network: "testnet", transcript: "send 2 XLM to acc2 tomorrow at 15:00", timeZone: "Europe/Istanbul" },
  );
  assert.equal(intent.kind, "schedule_payment");
  assert.equal("repeat" in intent, false);
  assert.equal(intent.firstRun?.timeZone, "Europe/Istanbul");
});

test("schedule_payment: an explicit IANA zone overrides the device zone", () => {
  const intent = parseSchedulePayment(
    {
      amount: "1",
      asset: "USDC",
      recipient: "ada",
      firstDate: "2026-09-21",
      firstTime: "09:00",
      timeZone: "America/New_York",
    },
    ISTANBUL,
  );
  assert.equal(intent.firstRun?.timeZone, "America/New_York");
});

test("schedule_payment: an invalid zone is rejected as bad input", () => {
  assert.throws(
    () =>
      parseSchedulePayment(
        {
          amount: "1",
          asset: "USDC",
          recipient: "ada",
          firstDate: "2026-09-21",
          firstTime: "09:00",
          timeZone: "Mars/Olympus",
        },
        ISTANBUL,
      ),
    (error: unknown) => error instanceof AgentError && error.kind === "input",
  );
});

test("schedule_payment: a repeat without a run count is rejected (ask how many)", () => {
  assert.throws(
    () =>
      parseSchedulePayment(
        { amount: "1", asset: "XLM", recipient: "a", firstDate: "2026-09-21", firstTime: "09:00", repeat: "week" },
        ISTANBUL,
      ),
    (error: unknown) => error instanceof AgentError && /runs/.test(error.detail),
  );
});

test("schedule_payment: a one-shot with runs > 1 is rejected", () => {
  assert.throws(
    () =>
      parseSchedulePayment(
        { amount: "1", asset: "XLM", recipient: "a", firstDate: "2026-09-21", firstTime: "09:00", runs: 3 },
        ISTANBUL,
      ),
    (error: unknown) => error instanceof AgentError && error.kind === "input",
  );
});

test("schedule_payment: custom repeat requires a positive intervalSeconds", () => {
  assert.throws(
    () =>
      parseSchedulePayment(
        { amount: "1", asset: "XLM", recipient: "a", firstDate: "2026-09-21", firstTime: "09:00", repeat: "custom", runs: 2 },
        ISTANBUL,
      ),
    (error: unknown) => error instanceof AgentError && /intervalSeconds/.test(error.detail),
  );
  const intent = parseSchedulePayment(
    { amount: "1", asset: "XLM", recipient: "a", firstDate: "2026-09-21", firstTime: "09:00", repeat: "custom", intervalSeconds: 3600, runs: 2 },
    ISTANBUL,
  );
  assert.deepEqual(intent.repeat, { every: "custom", customSeconds: 3600 });
});

test("schedule_payment: malformed dates, times and unknown assets are rejected", () => {
  const base = { amount: "1", asset: "XLM", recipient: "a", firstDate: "2026-09-21", firstTime: "09:00" };
  for (const bad of [
    { ...base, firstDate: "21-09-2026" },
    { ...base, firstTime: "9am" },
    { ...base, asset: "DOGE" },
    { ...base, recipient: "" },
  ]) {
    assert.throws(
      () => parseSchedulePayment(bad, ISTANBUL),
      (error: unknown) => error instanceof AgentError && error.kind === "input",
    );
  }
});

test("normalizeRepeat maps Turkish and English cadence words", () => {
  for (const word of ["her cuma", "every friday", "weekly", "her hafta"]) {
    assert.equal(normalizeRepeat(word), "week", word);
  }
  for (const word of ["day", "daily", "her gün", "günlük"]) {
    assert.equal(normalizeRepeat(word), "day", word);
  }
  assert.equal(normalizeRepeat(undefined), "none");
  assert.equal(normalizeRepeat(""), "none");
  assert.equal(normalizeRepeat("fortnightly"), undefined);
});

test("cancel_schedule: a recipient alias produces a cancel Intent", () => {
  const intent = parseCancelSchedule(
    { recipient: "acc2" },
    { network: "testnet", transcript: "acc2'ye olan ödemeyi iptal et" },
  );
  assert.deepEqual(intent, {
    kind: "cancel_schedule",
    asset: "",
    amount: "",
    recipient: "acc2",
    source: "acc2'ye olan ödemeyi iptal et",
  });
});

test("cancel_schedule: an explicit id and a disambiguation word are carried through", () => {
  const byId = parseCancelSchedule({ scheduleId: 7 }, ISTANBUL);
  assert.equal(byId.scheduleId, 7);
  const which = parseCancelSchedule({ recipient: "acc2", which: "son" }, ISTANBUL);
  assert.equal(which.which, "last");
});

test("cancel_schedule: neither recipient nor id, and 'which' without recipient, are rejected", () => {
  for (const bad of [{}, { which: "next" }, { scheduleId: -1 }, { scheduleId: 1.5 }]) {
    assert.throws(
      () => parseCancelSchedule(bad, ISTANBUL),
      (error: unknown) => error instanceof AgentError && error.kind === "input",
      JSON.stringify(bad),
    );
  }
});

test("normalizeWhich accepts Turkish words", () => {
  assert.equal(normalizeWhich("next"), "next");
  assert.equal(normalizeWhich("gelecek"), "next");
  assert.equal(normalizeWhich("son"), "last");
  assert.equal(normalizeWhich("banana"), undefined);
});
