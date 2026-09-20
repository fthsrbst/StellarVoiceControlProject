import assert from "node:assert/strict";
import { test } from "node:test";
import type { PolarisEvent } from "@polaris/interfaces";

import { clearEventTail, eventsInTail, lastEvent, recordEvent, TAIL_LIMIT } from "./eventTail.ts";

test("lastEvent returns the most recent event of a type", () => {
  clearEventTail();
  recordEvent({ type: "hotkey_permission", trusted: false });
  recordEvent({ type: "hotkey", state: "down" });
  recordEvent({ type: "hotkey_permission", trusted: true });

  const permission = lastEvent("hotkey_permission");
  assert.equal(permission?.trusted, true);
  assert.equal(lastEvent("transcript"), null);
});

test("the tail keeps at most TAIL_LIMIT events, dropping the oldest", () => {
  clearEventTail();
  const count = TAIL_LIMIT + 10;
  for (let index = 0; index < count; index += 1) {
    recordEvent({ type: "error", message: `event-${index}` });
  }
  const tail = eventsInTail();
  assert.equal(tail.length, TAIL_LIMIT);
  const first = tail[0] as Extract<PolarisEvent, { type: "error" }>;
  assert.equal(first.message, `event-${10}`);
});

test("clearEventTail empties the tail", () => {
  clearEventTail();
  recordEvent({ type: "error", message: "x" });
  clearEventTail();
  assert.equal(eventsInTail().length, 0);
});
