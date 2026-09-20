import assert from "node:assert/strict";
import { test } from "node:test";

import { parseSummaryLine, parseSummaryLines } from "./summaryLines.ts";

test("a destination line becomes a To pair, with or without a colon", () => {
  assert.deepEqual(parseSummaryLine("To GABC123"), { kind: "pair", label: "To", value: "GABC123" });
  assert.deepEqual(parseSummaryLine("To: GABC123"), { kind: "pair", label: "To", value: "GABC123" });
  assert.deepEqual(parseSummaryLine("to   GABC123"), { kind: "pair", label: "To", value: "GABC123" });
});

test("a fee line becomes a Fee pair, in any case", () => {
  assert.deepEqual(parseSummaryLine("Fee: 0.00001 XLM"), {
    kind: "pair",
    label: "Fee",
    value: "0.00001 XLM",
  });
  assert.deepEqual(parseSummaryLine("fee 0.00001 XLM"), {
    kind: "pair",
    label: "Fee",
    value: "0.00001 XLM",
  });
});

test("an unknown line is preserved verbatim", () => {
  for (const line of ["Memo: invoice 42", "Operation: payment", "Anything at all", "", "Total: 3"]) {
    assert.deepEqual(parseSummaryLine(line), { kind: "plain", text: line });
  }
});

test("a bare label without a value is not a pair", () => {
  assert.deepEqual(parseSummaryLine("To"), { kind: "plain", text: "To" });
  assert.deepEqual(parseSummaryLine("Fee:"), { kind: "plain", text: "Fee:" });
});

test("parseSummaryLines keeps order and never drops a line", () => {
  const lines = ["Send 1 XLM", "To GABC", "Memo x", "Fee: 0.1 XLM"];
  assert.deepEqual(parseSummaryLines(lines), [
    { kind: "plain", text: "Send 1 XLM" },
    { kind: "pair", label: "To", value: "GABC" },
    { kind: "plain", text: "Memo x" },
    { kind: "pair", label: "Fee", value: "0.1 XLM" },
  ]);
  assert.equal(parseSummaryLines(lines).length, lines.length);
});
