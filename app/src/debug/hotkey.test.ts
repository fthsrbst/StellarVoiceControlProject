import assert from "node:assert/strict";
import { test } from "node:test";

import hotkey from "./checks/hotkey.ts";
import { clearEventTail, recordEvent } from "./eventTail.ts";

test("with no hotkey_permission event the check asks for one", async () => {
  clearEventTail();
  const result = await hotkey.run();
  assert.equal(result.status, "unknown");
  assert.match(result.detail, /Control\+Option/);
});

test("a granted hotkey_permission event makes the check ok", async () => {
  clearEventTail();
  recordEvent({ type: "hotkey_permission", trusted: true });
  const result = await hotkey.run();
  assert.equal(result.status, "ok");
});

test("a denied hotkey_permission event is a warning, not a failure", async () => {
  clearEventTail();
  recordEvent({ type: "hotkey_permission", trusted: false });
  const result = await hotkey.run();
  assert.equal(result.status, "warn");
  assert.match(result.detail, /Control\+Option\+Space/);
});
