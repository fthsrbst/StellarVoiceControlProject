import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChainToolResult, Intent } from "@polaris/interfaces";

import {
  createAutoApprovalPlaceholder,
  createDenyApprover,
  executeIntent,
  isNotImplementedError,
  payloadHashOfXdr,
  resolveApprover,
  sha256Hex,
  type ApprovalRequest,
  type ChainToolSet,
  type IntentApprover,
} from "./execution.ts";

const INTENT: Intent = { kind: "send", asset: "USDC", amount: "5", recipient: "Ahmet" };

const RESULT: ChainToolResult = {
  unsignedXdr: "AAAA...unsigned",
  summary: {
    title: "Send 5 USDC to Ahmet",
    lines: ["amount: 5 USDC", "destination: Ahmet"],
    estimatedFee: "0.00001 XLM",
  },
};

const HASH = sha256Hex(RESULT.unsignedXdr);

/** Records the order in which the gate and the tool are reached. */
function recordingApprover(
  decision: { approved: boolean; reason?: string },
  log: string[],
): IntentApprover {
  return {
    async approve(request: ApprovalRequest) {
      log.push(`approve:${request.summary.title}`);
      return decision;
    },
  };
}

test("the tool builds first and the approver receives the summary + payload hash", async () => {
  const log: string[] = [];
  let seen: ApprovalRequest | undefined;
  const chainTools: ChainToolSet = {
    send: async () => {
      log.push("tool:send");
      return RESULT;
    },
  };
  const approver: IntentApprover = {
    async approve(request) {
      log.push("approve");
      seen = request;
      return { approved: true };
    },
  };

  const outcome = await executeIntent(INTENT, { approver, chainTools });

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.result, RESULT);
  assert.equal(outcome.payloadHash, HASH);
  // W1 order: the side-effect-free chain tool runs before the human decision, so
  // the card has something to show.
  assert.deepEqual(log, ["tool:send", "approve"]);
  assert.deepEqual(seen, { intent: INTENT, summary: RESULT.summary, payloadHash: HASH });
});

test("the payload hash can be injected (used by tests to pin the request)", async () => {
  let seen: ApprovalRequest | undefined;
  const approver: IntentApprover = {
    async approve(request) {
      seen = request;
      return { approved: true };
    },
  };

  const outcome = await executeIntent(INTENT, {
    approver,
    chainTools: { send: async () => RESULT },
    payloadHash: () => "deadbeef",
  });

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.payloadHash, "deadbeef");
  assert.equal(seen?.payloadHash, "deadbeef");
});

test("a denied intent keeps no result and is never handed to a signer", async () => {
  const log: string[] = [];
  let toolCalls = 0;
  const chainTools: ChainToolSet = {
    send: async () => {
      toolCalls += 1;
      return RESULT;
    },
  };

  const outcome = await executeIntent(INTENT, {
    approver: recordingApprover({ approved: false, reason: "user cancelled" }, log),
    chainTools,
  });

  assert.equal(outcome.status, "rejected");
  assert.equal(outcome.label, "Not approved");
  assert.equal(outcome.detail, "user cancelled");
  // The XDR is built (side-effect-free) but discarded on deny.
  assert.equal(toolCalls, 1, "the tool builds the XDR before the gate");
  assert.equal(outcome.result, undefined);
  assert.equal(outcome.payloadHash, undefined);
});

test("a NotImplementedError stub settles as 'not wired yet' without an approval prompt", async () => {
  class NotImplementedError extends Error {
    constructor(what: string) {
      super(`${what} is not implemented yet (Milestone 3, Owner B)`);
      this.name = "NotImplementedError";
    }
  }

  let approveCalls = 0;
  const chainTools: ChainToolSet = {
    send: async (intent) => {
      throw new NotImplementedError(`sendPayment (intent: ${JSON.stringify(intent)})`);
    },
  };
  const approver: IntentApprover = {
    async approve() {
      approveCalls += 1;
      return { approved: true };
    },
  };

  const outcome = await executeIntent(INTENT, { approver, chainTools });

  assert.equal(outcome.status, "unavailable");
  assert.equal(outcome.label, "Chain not wired");
  assert.match(outcome.detail ?? "", /sendPayment .* not implemented yet/);
  assert.equal(outcome.result, undefined);
  assert.equal(approveCalls, 0, "a tool that cannot build must not open the approval gate");
});

test("a not_configured refusal is a labelled outcome, before the approver", async () => {
  class PaymentRefusal extends Error {
    readonly code = "not_configured";
    constructor(message: string) {
      super(message);
      this.name = "PaymentRefusal";
    }
  }

  let approveCalls = 0;
  const chainTools: ChainToolSet = {
    send: async () => {
      throw new PaymentRefusal("payments are not configured: call configurePayments(deps) first");
    },
  };

  const outcome = await executeIntent(INTENT, {
    approver: {
      async approve() {
        approveCalls += 1;
        return { approved: true };
      },
    },
    chainTools,
  });

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.label, "Chain not configured");
  assert.match(outcome.detail ?? "", /configurePayments/);
  assert.equal(approveCalls, 0);
});

test("a real chain failure is reported as a failure, distinct from 'not wired'", async () => {
  const chainTools: ChainToolSet = {
    send: async () => {
      throw new Error("horizon: 503");
    },
  };

  const outcome = await executeIntent(INTENT, {
    approver: recordingApprover({ approved: true }, []),
    chainTools,
  });

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.label, "Chain error");
  assert.equal(outcome.detail, "horizon: 503");
});

test("an intent with no registered chain tool is 'unsupported', never silently ignored", async () => {
  const outcome = await executeIntent(
    { kind: "raw_tx", asset: "USDC", amount: "1" },
    { approver: recordingApprover({ approved: true }, []), chainTools: {} },
  );

  assert.equal(outcome.status, "unsupported");
  assert.equal(outcome.label, "Not supported");
  assert.match(outcome.detail ?? "", /raw_tx/);
});

test("the placeholder approver approves and is clearly not Touch ID", async () => {
  const outcome = await executeIntent(INTENT, {
    approver: createAutoApprovalPlaceholder(),
    chainTools: { send: async () => RESULT },
  });
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.payloadHash, HASH);
});

test("isNotImplementedError matches by name, like the stellar stub contract", () => {
  const error = new Error("nope");
  error.name = "NotImplementedError";
  assert.equal(isNotImplementedError(error), true);
  assert.equal(isNotImplementedError(new Error("nope")), false);
  assert.equal(isNotImplementedError("nope"), false);
  assert.equal(isNotImplementedError(undefined), false);
});

/* ------------------------------------------------------------------ *
 * M7 — the contract says "never throws"; a throwing approver must not escape.
 * ------------------------------------------------------------------ */

test("a throwing approver becomes a labelled failure and keeps no result", async () => {
  let toolCalls = 0;
  const chainTools: ChainToolSet = {
    send: async () => {
      toolCalls += 1;
      return RESULT;
    },
  };
  const throwing: IntentApprover = {
    async approve() {
      throw new Error("biometric cancelled");
    },
  };

  // The realistic Touch ID shape: cancel/error rejects `approve()`. It must be
  // mapped to an outcome, not propagated (the App's catch is generic and
  // unpinned).
  const outcome = await executeIntent(INTENT, { approver: throwing, chainTools });

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.label, "Approval error");
  assert.match(outcome.detail ?? "", /biometric cancelled/);
  assert.equal(toolCalls, 1);
  assert.equal(outcome.result, undefined);
});

/* ------------------------------------------------------------------ *
 * M5 — the default approver fails closed.
 * ------------------------------------------------------------------ */

test("the default approver fails closed: no auto-approval without an explicit opt-in", async () => {
  const chainTools: ChainToolSet = {
    send: async () => RESULT,
  };

  // `resolveApprover(false)` is what the composition root uses when the opt-in
  // flag is absent. A value-moving step must be unreachable through it.
  const outcome = await executeIntent(INTENT, {
    approver: resolveApprover(false),
    chainTools,
  });

  assert.equal(outcome.status, "rejected");
  assert.equal(outcome.label, "Not approved");
  assert.equal(outcome.result, undefined);
});

test("the deny gate denies with a reason, and auto-approval needs the opt-in", async () => {
  const request: ApprovalRequest = { intent: INTENT, summary: RESULT.summary, payloadHash: HASH };
  const denied = await createDenyApprover("no gate configured").approve(request);
  assert.equal(denied.approved, false);
  assert.equal(denied.reason, "no gate configured");

  // The opt-in still installs the placeholder, so the stubbed demo can reach
  // the execution seam.
  assert.equal((await resolveApprover(true).approve(request)).approved, true);
  assert.equal((await resolveApprover(false).approve(request)).approved, false);
});

/* ------------------------------------------------------------------ *
 * W1 — the payload hash is a pure SHA-256 of the unsigned XDR.
 * ------------------------------------------------------------------ */

test("sha256Hex matches the known SHA-256 vectors", () => {
  assert.equal(
    sha256Hex(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  assert.equal(
    sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.equal(
    sha256Hex("The quick brown fox jumps over the lazy dog"),
    "d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592",
  );
});

test("payloadHashOfXdr hashes the XDR string", () => {
  assert.equal(payloadHashOfXdr(RESULT.unsignedXdr), sha256Hex(RESULT.unsignedXdr));
});
