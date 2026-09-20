import assert from "node:assert/strict";
import { test } from "node:test";

import { INITIAL_TX_RUN, txRunReducer, type TxRunView } from "./useTxRun.ts";
import type { TxRunOutcome } from "./txPipeline.ts";

const OUTCOME: TxRunOutcome = {
  status: "submitted",
  txHash: "a".repeat(64),
  explorerUrl: "https://stellar.expert/explorer/testnet/tx/aaa",
  atMs: 5,
};

test("the initial view is idle with no progress or outcomes", () => {
  assert.deepEqual(INITIAL_TX_RUN, { state: "idle", progress: null, outcomes: [] });
});

test("start enters running and clears any previous outcomes", () => {
  const dirty: TxRunView = { state: "done", progress: null, outcomes: [OUTCOME] };
  const next = txRunReducer(dirty, { type: "start", total: 2 });
  assert.deepEqual(next, { state: "running", progress: null, outcomes: [] });
});

test("progress updates the tick without leaving running", () => {
  const running = txRunReducer(INITIAL_TX_RUN, { type: "start", total: 3 });
  const next = txRunReducer(running, {
    type: "progress",
    progress: { index: 1, total: 3, label: "B", phase: "approving" },
  });
  assert.equal(next.state, "running");
  assert.deepEqual(next.progress, { index: 1, total: 3, label: "B", phase: "approving" });
});

test("outcomes settles the run as done and keeps the last progress", () => {
  const running = txRunReducer(INITIAL_TX_RUN, { type: "start", total: 1 });
  const withProgress = txRunReducer(running, {
    type: "progress",
    progress: { index: 0, total: 1, label: "A", phase: "submitted" },
  });
  const done = txRunReducer(withProgress, { type: "outcomes", outcomes: [OUTCOME] });
  assert.equal(done.state, "done");
  assert.deepEqual(done.outcomes, [OUTCOME]);
  assert.equal(done.progress?.label, "A");
});

test("reset returns to the initial view", () => {
  const done = txRunReducer(INITIAL_TX_RUN, { type: "outcomes", outcomes: [OUTCOME] });
  assert.deepEqual(txRunReducer(done, { type: "reset" }), INITIAL_TX_RUN);
});
