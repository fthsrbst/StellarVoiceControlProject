import assert from "node:assert/strict";
import { test } from "node:test";

import { isPanelName, parseApprovalDemo, parsePanelRoute } from "./panelRoutes.ts";

test("the no-hash window is the notch overlay", () => {
  assert.deepEqual(parsePanelRoute(""), { kind: "notch" });
  assert.deepEqual(parsePanelRoute("#"), { kind: "notch" });
  assert.deepEqual(parsePanelRoute("#/"), { kind: "notch" });
});

test("each known panel route parses to its panel", () => {
  assert.deepEqual(parsePanelRoute("#/wallet"), { kind: "panel", panel: "wallet" });
  assert.deepEqual(parsePanelRoute("#/approval"), { kind: "panel", panel: "approval" });
  assert.deepEqual(parsePanelRoute("#/security"), { kind: "panel", panel: "security" });
  assert.deepEqual(parsePanelRoute("#/schedules"), { kind: "panel", panel: "schedules" });
  assert.deepEqual(parsePanelRoute("#/suggestions"), {
    kind: "panel",
    panel: "suggestions",
  });
  assert.deepEqual(parsePanelRoute("#/anchor"), { kind: "panel", panel: "anchor" });
  assert.deepEqual(parsePanelRoute("#/p2p"), { kind: "panel", panel: "p2p" });
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

test("the approval demo query parses only for the approval panel", () => {
  assert.equal(parseApprovalDemo("#/approval?demo=1"), "live");
  assert.equal(parseApprovalDemo("#/approval?demo=true"), "live");
  assert.equal(parseApprovalDemo("#/approval?demo"), "live");
  assert.equal(parseApprovalDemo("#/approval?demo=expired"), "expired");
  assert.equal(parseApprovalDemo("#/approval?demo=error"), "error");
  // Case is tolerated on the value.
  assert.equal(parseApprovalDemo("#/approval?demo=EXPIRED"), "expired");
});

test("no demo value — or one on another panel — stays real mode", () => {
  assert.equal(parseApprovalDemo("#/approval"), null);
  assert.equal(parseApprovalDemo("#/approval?tab=history"), null);
  assert.equal(parseApprovalDemo("#/wallet?demo=1"), null);
  assert.equal(parseApprovalDemo(""), null);
});

test("an unknown demo value falls back to real mode", () => {
  assert.equal(parseApprovalDemo("#/approval?demo=bogus"), null);
  assert.equal(parseApprovalDemo("#/approval?demo=0"), null);
});

test("isPanelName accepts only the registry names", () => {
  assert.equal(isPanelName("wallet"), true);
  assert.equal(isPanelName("approval"), true);
  assert.equal(isPanelName("security"), true);
  assert.equal(isPanelName("schedules"), true);
  assert.equal(isPanelName("suggestions"), true);
  assert.equal(isPanelName("anchor"), true);
  assert.equal(isPanelName("p2p"), true);
  assert.equal(isPanelName("settings"), true);
  assert.equal(isPanelName("debug"), true);
  assert.equal(isPanelName("Wallet"), false);
  assert.equal(isPanelName("main"), false);
  assert.equal(isPanelName(""), false);
});
