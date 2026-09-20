import assert from "node:assert/strict";
import { test } from "node:test";

import { isPanelName, parsePanelRoute } from "./panelRoutes.ts";

test("the no-hash window is the notch overlay", () => {
  assert.deepEqual(parsePanelRoute(""), { kind: "notch" });
  assert.deepEqual(parsePanelRoute("#"), { kind: "notch" });
  assert.deepEqual(parsePanelRoute("#/"), { kind: "notch" });
});

test("each known panel route parses to its panel", () => {
  assert.deepEqual(parsePanelRoute("#/wallet"), { kind: "panel", panel: "wallet" });
  assert.deepEqual(parsePanelRoute("#/approval"), { kind: "panel", panel: "approval" });
  assert.deepEqual(parsePanelRoute("#/settings"), { kind: "panel", panel: "settings" });
  assert.deepEqual(parsePanelRoute("#/debug"), { kind: "panel", panel: "debug" });
});

test("trailing slashes, a missing hash and a query string are tolerated", () => {
  assert.deepEqual(parsePanelRoute("#/wallet/"), { kind: "panel", panel: "wallet" });
  assert.deepEqual(parsePanelRoute("/wallet"), { kind: "panel", panel: "wallet" });
  assert.deepEqual(parsePanelRoute("#/wallet?tab=history"), {
    kind: "panel",
    panel: "wallet",
  });
  assert.deepEqual(parsePanelRoute("#//wallet//"), { kind: "panel", panel: "wallet" });
});

test("the panel name is matched case-insensitively", () => {
  assert.deepEqual(parsePanelRoute("#/Wallet"), { kind: "panel", panel: "wallet" });
  assert.deepEqual(parsePanelRoute("#/SETTINGS"), { kind: "panel", panel: "settings" });
});

test("an unknown hash falls back to the notch, never a blank window", () => {
  assert.deepEqual(parsePanelRoute("#/bogus"), { kind: "notch" });
  assert.deepEqual(parsePanelRoute("#/wallet/extra"), { kind: "notch" });
  assert.deepEqual(parsePanelRoute("nonsense"), { kind: "notch" });
});

test("isPanelName accepts only the registry names", () => {
  assert.equal(isPanelName("wallet"), true);
  assert.equal(isPanelName("approval"), true);
  assert.equal(isPanelName("settings"), true);
  assert.equal(isPanelName("debug"), true);
  assert.equal(isPanelName("Wallet"), false);
  assert.equal(isPanelName("main"), false);
  assert.equal(isPanelName(""), false);
});
