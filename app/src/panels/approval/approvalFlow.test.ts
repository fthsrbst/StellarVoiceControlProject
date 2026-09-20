import assert from "node:assert/strict";
import { test } from "node:test";

import type { ApprovalSnapshot } from "../../lib/approval.ts";
import {
  CANCELLED_HINT,
  EXPIRED_MESSAGE,
  canApprove,
  currentSnapshot,
  initialApprovalState,
  isAuthorizing,
  reduceApproval,
  remainingMs,
  type ApprovalFlowState,
} from "./approvalFlow.ts";

function snapshot(overrides: Partial<ApprovalSnapshot> = {}): ApprovalSnapshot {
  return {
    id: "req-1",
    payloadHash: "hash-1",
    summary: { title: "Send 1 XLM", lines: ["To GABC"], estimatedFee: "0.00001 XLM" },
    intent: { kind: "send", asset: "XLM", amount: "1" },
    mode: "touch_id",
    state: "pending",
    expiresAtMs: 10_000,
    ...overrides,
  };
}

/** A live pending state at `nowMs`. */
function pending(nowMs = 0, overrides: Partial<ApprovalSnapshot> = {}): ApprovalFlowState {
  return { stage: "pending", snapshot: snapshot(overrides), nowMs, hint: null };
}

function authorizing(nowMs = 0): ApprovalFlowState {
  return { stage: "authorizing", snapshot: snapshot(), nowMs };
}

/* ------------------------------------------------------------------ *
 * Hydration — the panel opens after the event, so this is the entry path.
 * ------------------------------------------------------------------ */

test("the card starts idle and a null snapshot keeps it idle", () => {
  assert.deepEqual(initialApprovalState(), { stage: "idle" });
  assert.deepEqual(
    reduceApproval(initialApprovalState(), { type: "snapshot", snapshot: null, nowMs: 0 }),
    { stage: "idle" },
  );
});

test("hydrates each snapshot state, marking a past deadline expired", () => {
  const now = 5_000;
  assert.deepEqual(
    reduceApproval(initialApprovalState(), { type: "snapshot", snapshot: snapshot(), nowMs: now }),
    { stage: "pending", snapshot: snapshot(), nowMs: now, hint: null },
  );
  assert.deepEqual(
    reduceApproval(initialApprovalState(), {
      type: "snapshot",
      snapshot: snapshot({ expiresAtMs: 1_000 }),
      nowMs: now,
    }),
    { stage: "expired", snapshot: snapshot({ expiresAtMs: 1_000 }) },
  );
  assert.deepEqual(
    reduceApproval(initialApprovalState(), {
      type: "snapshot",
      snapshot: snapshot({ state: "authorized" }),
      nowMs: now,
    }),
    { stage: "authorized", snapshot: snapshot({ state: "authorized" }) },
  );
  assert.deepEqual(
    reduceApproval(initialApprovalState(), {
      type: "snapshot",
      snapshot: snapshot({ state: "consumed" }),
      nowMs: now,
    }),
    { stage: "authorized", snapshot: snapshot({ state: "consumed" }) },
  );
  assert.deepEqual(
    reduceApproval(initialApprovalState(), {
      type: "snapshot",
      snapshot: snapshot({ state: "denied" }),
      nowMs: now,
    }),
    { stage: "denied", snapshot: snapshot({ state: "denied" }) },
  );
  assert.deepEqual(
    reduceApproval(initialApprovalState(), {
      type: "snapshot",
      snapshot: snapshot({ state: "expired" }),
      nowMs: now,
    }),
    { stage: "expired", snapshot: snapshot({ state: "expired" }) },
  );
});

test("an unrecognised snapshot state fails closed into error", () => {
  const broken = snapshot({ state: "quantum" as ApprovalSnapshot["state"] });
  const state = reduceApproval(initialApprovalState(), {
    type: "snapshot",
    snapshot: broken,
    nowMs: 0,
  });
  assert.equal(state.stage, "error");
  assert.equal(canApprove(state), false);
});

test("a failed hydration is an error with no snapshot", () => {
  const state = reduceApproval(initialApprovalState(), {
    type: "snapshotFailed",
    error: { kind: "failed", message: "store offline" },
  });
  assert.deepEqual(state, { stage: "error", snapshot: null, error: { kind: "failed", message: "store offline" } });
  assert.equal(canApprove(state), false);
});

/* ------------------------------------------------------------------ *
 * The approve gesture and its lock.
 * ------------------------------------------------------------------ */

test("the happy path runs pending -> authorizing -> authorized", () => {
  const started = reduceApproval(pending(), { type: "approveClicked" });
  assert.equal(started.stage, "authorizing");
  assert.equal(canApprove(started), false, "Approve is locked while authorizing");
  assert.equal(isAuthorizing(started), true);

  const done = reduceApproval(started, {
    type: "authorizeOk",
    snapshot: snapshot({ state: "authorized" }),
  });
  assert.deepEqual(done, { stage: "authorized", snapshot: snapshot({ state: "authorized" }) });
});

test("a double click cannot start a second gesture", () => {
  const started = reduceApproval(pending(), { type: "approveClicked" });
  const again = reduceApproval(started, { type: "approveClicked" });
  assert.deepEqual(again, started);
});

test("Approve does nothing outside pending", () => {
  assert.deepEqual(reduceApproval(initialApprovalState(), { type: "approveClicked" }), {
    stage: "idle",
  });
  const authorized: ApprovalFlowState = { stage: "authorized", snapshot: snapshot() };
  assert.deepEqual(reduceApproval(authorized, { type: "approveClicked" }), authorized);
});

/* ------------------------------------------------------------------ *
 * Deny and the keyboard path.
 * ------------------------------------------------------------------ */

test("deny is available while pending and while authorizing", () => {
  assert.equal(reduceApproval(pending(), { type: "denyClicked" }).stage, "denied");
  assert.equal(reduceApproval(authorizing(), { type: "denyClicked" }).stage, "denied");
});

test("deny does nothing once the request is settled", () => {
  const authorized: ApprovalFlowState = { stage: "authorized", snapshot: snapshot() };
  assert.deepEqual(reduceApproval(authorized, { type: "denyClicked" }), authorized);
  assert.deepEqual(reduceApproval(initialApprovalState(), { type: "denyClicked" }), {
    stage: "idle",
  });
});

/* ------------------------------------------------------------------ *
 * Failure kinds.
 * ------------------------------------------------------------------ */

test("a cancelled gesture returns to pending with a calm hint", () => {
  const state = reduceApproval(authorizing(), { type: "authorizeFailed", kind: "cancelled" });
  assert.deepEqual(state, {
    stage: "pending",
    snapshot: snapshot(),
    nowMs: 0,
    hint: CANCELLED_HINT,
  });
});

test("a cancelled gesture on an expired request becomes expired, not pending", () => {
  const stale: ApprovalFlowState = { stage: "authorizing", snapshot: snapshot(), nowMs: 10_000 };
  assert.equal(
    reduceApproval(stale, { type: "authorizeFailed", kind: "cancelled" }).stage,
    "expired",
  );
});

test("failed, unavailable, timeout and notPending become error", () => {
  for (const kind of ["failed", "unavailable", "timeout", "notPending"] as const) {
    const state = reduceApproval(authorizing(), { type: "authorizeFailed", kind });
    assert.equal(state.stage, "error", `${kind} must fail closed`);
    assert.equal(canApprove(state), false);
  }
});

test("expired is expired, never an error card", () => {
  assert.equal(
    reduceApproval(authorizing(), { type: "authorizeFailed", kind: "expired" }).stage,
    "expired",
  );
});

test("a stale failure outside authorizing is ignored", () => {
  const live = pending();
  assert.deepEqual(
    reduceApproval(live, { type: "authorizeFailed", kind: "cancelled" }),
    live,
  );
  const authorized: ApprovalFlowState = { stage: "authorized", snapshot: snapshot() };
  assert.deepEqual(
    reduceApproval(authorized, { type: "authorizeFailed", kind: "failed" }),
    authorized,
  );
});

/* ------------------------------------------------------------------ *
 * Expiry via the injected clock.
 * ------------------------------------------------------------------ */

test("tick past the deadline expires a pending request and disables Approve", () => {
  const state = reduceApproval(pending(), { type: "tick", nowMs: 10_000 });
  assert.equal(state.stage, "expired");
  assert.equal(canApprove(state), false);
});

test("tick before the deadline only advances the clock", () => {
  const state = reduceApproval(pending(), { type: "tick", nowMs: 4_000 });
  assert.deepEqual(state, { stage: "pending", snapshot: snapshot(), nowMs: 4_000, hint: null });
  assert.equal(remainingMs(state), 6_000);
  assert.equal(canApprove(state), true);
});

test("clicking Approve on a just-expired request expires instead of authorizing", () => {
  const stale = pending(10_000);
  assert.equal(reduceApproval(stale, { type: "approveClicked" }).stage, "expired");
});

test("tick cannot move a settled request", () => {
  const authorized: ApprovalFlowState = { stage: "authorized", snapshot: snapshot() };
  assert.deepEqual(reduceApproval(authorized, { type: "tick", nowMs: 99_999 }), authorized);
  assert.equal(remainingMs(authorized), null);
});

/* ------------------------------------------------------------------ *
 * The result event is keyed by payload hash.
 * ------------------------------------------------------------------ */

test("a matching result approves or denies", () => {
  assert.equal(
    reduceApproval(pending(), { type: "result", payloadHash: "hash-1", approved: true }).stage,
    "authorized",
  );
  assert.equal(
    reduceApproval(pending(), { type: "result", payloadHash: "hash-1", approved: false }).stage,
    "denied",
  );
});

test("a result for a different payload hash is ignored", () => {
  const live = pending();
  assert.deepEqual(
    reduceApproval(live, { type: "result", payloadHash: "some-other-hash", approved: true }),
    live,
  );
  assert.deepEqual(
    reduceApproval(initialApprovalState(), {
      type: "result",
      payloadHash: "hash-1",
      approved: true,
    }),
    { stage: "idle" },
  );
});

test("the expired message is the agreed copy", () => {
  assert.equal(EXPIRED_MESSAGE, "This request expired — ask again by voice");
  assert.equal(currentSnapshot(pending())?.id, "req-1");
});
