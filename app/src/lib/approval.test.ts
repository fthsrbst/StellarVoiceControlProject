import assert from "node:assert/strict";
import { test } from "node:test";

import type { ApprovalSnapshot } from "./approval.ts";
import {
  approvalAuthorize,
  approvalCurrent,
  approvalDeny,
  createApprovalCommands,
  toApprovalError,
  type InvokeFn,
} from "./approval.ts";

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

/** A scripted `invoke` that records every command and delegates to `handler`. */
function mockInvoke(handler: (command: string, args?: Record<string, unknown>) => unknown) {
  const calls: { command: string; args?: Record<string, unknown> }[] = [];
  const invoke: InvokeFn = async <T>(command: string, args?: Record<string, unknown>) => {
    calls.push(args === undefined ? { command } : { command, args });
    return handler(command, args) as T;
  };
  return { invoke, calls };
}

test("approval_current resolves a snapshot and passes no arguments", async () => {
  const expected = snapshot();
  const { invoke, calls } = mockInvoke(() => expected);
  assert.deepEqual(await approvalCurrent(invoke), expected);
  assert.deepEqual(calls, [{ command: "approval_current" }]);
});

test("approval_current resolves null when there is no pending request", async () => {
  const { invoke } = mockInvoke(() => null);
  assert.equal(await approvalCurrent(invoke), null);
});

test("approval_authorize and approval_deny address the request by id", async () => {
  const authorized = snapshot({ state: "authorized" });
  const denied = snapshot({ state: "denied" });

  const auth = mockInvoke(() => authorized);
  assert.deepEqual(await approvalAuthorize("req-9", auth.invoke), authorized);
  assert.deepEqual(auth.calls, [{ command: "approval_authorize", args: { id: "req-9" } }]);

  const deny = mockInvoke(() => denied);
  assert.deepEqual(await approvalDeny("req-9", deny.invoke), denied);
  assert.deepEqual(deny.calls, [{ command: "approval_deny", args: { id: "req-9" } }]);
});

test("createApprovalCommands binds all three commands to one invoke", async () => {
  const commands = createApprovalCommands(async <T>(command: string) => {
    if (command === "approval_current") return snapshot() as T;
    return snapshot({ state: "authorized" }) as T;
  });
  assert.deepEqual(await commands.current(), snapshot());
  assert.equal((await commands.authorize("req-1")).state, "authorized");
  assert.equal((await commands.deny("req-1")).state, "authorized");
});

test("a structured rejection keeps its kind and message", async () => {
  const { invoke } = mockInvoke(() => {
    throw { kind: "cancelled", message: "user cancelled" };
  });
  await assert.rejects(approvalAuthorize("req-1", invoke), (error: unknown) => {
    assert.deepEqual(error, { kind: "cancelled", message: "user cancelled" });
    return true;
  });
});

test("every known error kind is preserved", async () => {
  for (const kind of ["cancelled", "failed", "unavailable", "timeout", "expired", "notPending"]) {
    const { invoke } = mockInvoke(() => {
      throw { kind, message: `kind ${kind}` };
    });
    await assert.rejects(approvalCurrent(invoke), (error: unknown) => {
      assert.deepEqual(error, { kind, message: `kind ${kind}` });
      return true;
    });
  }
});

test("an unknown rejection shape normalises to failed", async () => {
  const cases: unknown[] = [
    "transport exploded",
    new Error("boom"),
    { kind: "surprise", message: "nope" },
    42,
    null,
  ];
  for (const raw of cases) {
    const { invoke } = mockInvoke(() => {
      throw raw;
    });
    await assert.rejects(approvalCurrent(invoke), (error: unknown) => {
      assert.equal((error as { kind: string }).kind, "failed");
      return true;
    });
  }
});

test("toApprovalError keeps a known kind even without a message", () => {
  assert.deepEqual(toApprovalError({ kind: "timeout" }), {
    kind: "timeout",
    message: "Approval failed",
  });
  assert.deepEqual(toApprovalError({ kind: "expired", message: "" }), {
    kind: "expired",
    message: "Approval failed",
  });
  assert.deepEqual(toApprovalError("plain string"), { kind: "failed", message: "plain string" });
  assert.deepEqual(toApprovalError(undefined), { kind: "failed", message: "Approval failed" });
});
