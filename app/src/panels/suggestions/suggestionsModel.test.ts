import assert from "node:assert/strict";
import { test } from "node:test";

import { suggest } from "@polaris/stellar";

import {
  acceptTarget,
  computeSuggestions,
  DEFAULT_DISPLAY_ASSET,
  describeEvidence,
  pickDisplayAsset,
  suggestionDraft,
} from "./suggestionsModel.ts";

const DAY = 86_400;
const NOW = 1_700_000_000;
const OWNER_ASSET = "XLM";

/** A deterministic payment at `dayOffset` days before `NOW`. */
function rec(id: string, dayOffset: number, amount: string, asset = OWNER_ASSET): suggest.HistoryRecord {
  return {
    id,
    ts: NOW - dayOffset * DAY,
    recipientAddress: `G${id.toUpperCase().padEnd(55, "A")}`,
    asset,
    amountRaw: suggest.parseAmount(amount, 7),
    mode: "public",
    route: "direct",
    status: "confirmed",
  };
}

/** Eight payments over distinct days: enough for the engine to propose a threshold. */
function enoughHistory(): suggest.HistoryRecord[] {
  return Array.from({ length: 8 }, (_, index) => rec(`h${index}`, index + 1, "10"));
}

test("pickDisplayAsset chooses the busiest asset and prefers XLM on a tie", () => {
  assert.equal(pickDisplayAsset([rec("a", 1, "1", "USDC"), rec("b", 2, "1", "USDC")]), "USDC");
  assert.equal(
    pickDisplayAsset([rec("a", 1, "1", "USDC"), rec("b", 2, "1", "XLM")]),
    DEFAULT_DISPLAY_ASSET,
  );
  assert.equal(pickDisplayAsset([]), DEFAULT_DISPLAY_ASSET);
});

test("computeSuggestions runs the engine and reports an explanation when short", () => {
  const run = computeSuggestions({
    history: enoughHistory(),
    now: NOW,
    timeZone: "UTC",
    displayAsset: OWNER_ASSET,
    dismissed: [],
  });
  assert.ok(run.suggestions.length >= 1);
  assert.equal(run.noSuggestions, null);

  const short = computeSuggestions({
    history: [rec("only", 1, "10")],
    now: NOW,
    timeZone: "UTC",
    displayAsset: OWNER_ASSET,
    dismissed: [],
  });
  assert.equal(short.suggestions.length, 0);
  assert.equal(short.noSuggestions?.reason, "not_enough_history");
});

test("a dismissed suggestion is filtered out of the next run", () => {
  const base = {
    history: enoughHistory(),
    now: NOW,
    timeZone: "UTC",
    displayAsset: OWNER_ASSET,
  };
  const first = computeSuggestions({ ...base, dismissed: [] });
  assert.ok(first.suggestions.length > 0);
  const id = first.suggestions[0]!.id;
  const second = computeSuggestions({ ...base, dismissed: [id] });
  assert.equal(
    second.suggestions.some((suggestion) => suggestion.id === id),
    false,
  );
});

test("describeEvidence is a compact aggregate with no addresses", () => {
  const line = describeEvidence({
    windowDays: 30,
    count: 8,
    median: "10",
    p90: "12",
    max: "15",
    occurrences: 3,
    intervalDays: 7,
  });
  assert.match(line, /30 days/);
  assert.match(line, /8 payments/);
  assert.match(line, /median 10/);
  assert.match(line, /every ~7\.0 days/);
  assert.equal(line.includes("G"), false);
});

test("acceptTarget maps each kind to a panel, or none for an alert", () => {
  assert.equal(acceptTarget("auto_pay_threshold"), "security");
  assert.equal(acceptTarget("daily_limit"), "security");
  assert.equal(acceptTarget("tighten_dormant"), "security");
  assert.equal(acceptTarget("schedule_from_recurrence"), "schedules");
  assert.equal(acceptTarget("unusual_payment_alert"), null);
});

test("suggestionDraft names the change and says it was not applied", () => {
  const draft = suggestionDraft({
    id: "x",
    kind: "schedule_from_recurrence",
    title: "Create a recurring payment",
    rationale: "because",
    evidence: { windowDays: 30, count: 3, median: "10", p90: "10", max: "10" },
    proposedChange: { recipient: "G", asset: "XLM", amount: "10", firstRunAt: 1, intervalSecs: 7, runs: 3 },
    confidence: "medium",
  });
  assert.match(draft, /not applied/);
  assert.match(draft, /"runs": 3/);
});
