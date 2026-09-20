import assert from "node:assert/strict";
import { test } from "node:test";

import { Account, Asset, Keypair, Operation, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { setSequence } from "@polaris/stellar";
import { xdrDigest, type ApprovalRequest } from "@polaris/agent";
import type { ChainToolResult, Intent } from "@polaris/interfaces";

import { runTx, runTxSequence, type TxPipelineDeps, type TxRunStep } from "./txPipeline.ts";
import type { SubmittedOutcome } from "./signing.ts";

const UNSIGNED = "AAAA...unsigned";
const TX_HASH = "2f38a676d5ed29dad5043f5f105fe78c7fb355a4dd1bfc56c5e90ae33df33a2a";
const EXPLORER = `https://stellar.expert/explorer/testnet/tx/${TX_HASH}`;

const INTENT: Intent = { kind: "send", asset: "XLM", amount: "10", recipient: "acc2" };
const RESULT: ChainToolResult = {
  unsignedXdr: UNSIGNED,
  summary: { title: "Send 10 XLM", lines: ["to acc2"], estimatedFee: "0.00001 XLM" },
};

const APPROVED = { approved: true, approvalId: "apr_1" } as const;

function submitted(overrides: Partial<SubmittedOutcome> = {}): SubmittedOutcome {
  return {
    status: "executed",
    intent: INTENT,
    result: RESULT,
    payloadHash: xdrDigest(UNSIGNED),
    txHash: TX_HASH,
    explorerUrl: EXPLORER,
    ...overrides,
  };
}

/** A deps set with fixed seams; `now` is pinned so timestamps are deterministic. */
function deps(overrides: Partial<TxPipelineDeps> = {}): TxPipelineDeps {
  return {
    approver: { async approve() { return APPROVED; } },
    sign: async () => submitted(),
    now: () => 1_000,
    resequence: async (result) => result,
    ...overrides,
  };
}

test("submitted: digest → approve → sign returns the hash and link", async () => {
  let seen: ApprovalRequest | undefined;
  const d = deps({
    approver: {
      async approve(request) {
        seen = request;
        return APPROVED;
      },
    },
    now: () => 42,
  });

  const outcome = await runTx(RESULT, { intent: INTENT }, d);

  assert.deepEqual(outcome, {
    status: "submitted",
    txHash: TX_HASH,
    explorerUrl: EXPLORER,
    atMs: 42,
  });
  assert.equal(seen?.payloadHash, xdrDigest(UNSIGNED));
  assert.equal(seen?.unsignedXdr, UNSIGNED);
  assert.equal(seen?.intent, INTENT);
});

test("submitted: the signed outcome carries the gate's approval id", async () => {
  let approvalId: string | undefined;
  const d = deps({
    sign: async (outcome) => {
      approvalId = outcome.approvalId;
      return submitted();
    },
  });
  await runTx(RESULT, { intent: INTENT }, d);
  assert.equal(approvalId, "apr_1");
});

test("denied: a refused gate never reaches the signer", async () => {
  let signed = false;
  const d = deps({
    approver: { async approve() { return { approved: false, reason: "user said no" }; } },
    sign: async () => {
      signed = true;
      return submitted();
    },
    now: () => 7,
  });

  const outcome = await runTx(RESULT, { intent: INTENT, label: "Send" }, d);

  assert.deepEqual(outcome, {
    status: "denied",
    label: "Send",
    detail: "user said no",
    atMs: 7,
  });
  assert.equal(signed, false);
});

test("an approver that throws is a labelled failed outcome, not a rejection", async () => {
  const d = deps({
    approver: {
      async approve() {
        throw new Error("Touch ID unavailable");
      },
    },
    now: () => 3,
  });

  const outcome = await runTx(RESULT, { intent: INTENT }, d);

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.label, "Send 10 XLM");
  assert.equal(outcome.detail, "Approval error: Touch ID unavailable");
  assert.equal(outcome.atMs, 3);
});

test("a signer failure is a labelled failed outcome", async () => {
  const d = deps({
    sign: async () => ({
      status: "failed",
      intent: INTENT,
      label: "Wallet didn't sign",
      detail: "rejected",
    }),
  });

  const outcome = await runTx(RESULT, { intent: INTENT }, d);

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.label, "Send 10 XLM");
  assert.equal(outcome.detail, "rejected");
});

test("a throwing signer never escapes as a rejection", async () => {
  const d = deps({
    sign: async () => {
      throw new Error("bridge unreachable");
    },
  });

  const outcome = await runTx(RESULT, { intent: INTENT }, d);

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.label, "Send 10 XLM");
  assert.equal(outcome.detail, "Signing error: bridge unreachable");
});

test("an approved-but-unsigned result is a failure, never a submission", async () => {
  const d = deps({
    sign: async () => ({ status: "executed", intent: INTENT, result: RESULT }),
  });

  const outcome = await runTx(RESULT, { intent: INTENT }, d);

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.label, "Send 10 XLM");
  assert.equal(outcome.detail, "the transaction was not submitted");
});

/** A step whose summary title matches its label, so progress labels are readable. */
function step(label: string): TxRunStep {
  return {
    result: { unsignedXdr: `${UNSIGNED}-${label}`, summary: { title: label, lines: [], estimatedFee: "0.00001 XLM" } },
    intent: INTENT,
    label,
  };
}

test("runTxSequence runs in order, stops at the first failure, and reports progress", async () => {
  let approvals = 0;
  const d = deps({
    approver: {
      async approve() {
        approvals += 1;
        return approvals === 2 ? { approved: false, reason: "nope" } : APPROVED;
      },
    },
  });
  const progress: string[] = [];

  const outcomes = await runTxSequence([step("A"), step("B"), step("C")], d, (index, total, label, phase) =>
    progress.push(`${index}/${total} ${label} ${phase}`),
  );

  assert.equal(outcomes.length, 2);
  assert.equal(outcomes[0]?.status, "submitted");
  assert.equal(outcomes[1]?.status, "denied");
  assert.deepEqual(progress, [
    "0/3 A approving",
    "0/3 A submitted",
    "1/3 B approving",
    "1/3 B denied",
  ]);
});

test("runTxSequence returns one submitted outcome per step when all succeed", async () => {
  const outcomes = await runTxSequence([step("A"), step("B")], deps());
  assert.equal(outcomes.length, 2);
  assert.ok(outcomes.every((outcome) => outcome.status === "submitted"));
});

// ── sequences (B1: a plan must not submit a stale sequence) ──────────────────

const PASSPHRASE = "Test SDF Network ; September 2015";
const SOURCE = Keypair.random().publicKey();

/** A real unsigned payment envelope at an explicit account sequence. */
function xdrAt(sequence: string): string {
  const account = new Account(SOURCE, sequence);
  return new TransactionBuilder(account, { fee: "100", networkPassphrase: PASSPHRASE })
    .addOperation(
      Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: "1" }),
    )
    .setTimeout(30)
    .build()
    .toXDR();
}

/** The sequence number embedded in a real envelope. */
function sequenceOf(xdr: string): bigint {
  const tx = TransactionBuilder.fromXDR(xdr, PASSPHRASE);
  assert.ok(tx instanceof Transaction);
  return BigInt(tx.sequence);
}

test("runTxSequence resequences each step against the source's current sequence", async () => {
  const shared = xdrAt("100");
  const steps: TxRunStep[] = ["A", "B", "C"].map((label) => ({
    result: { unsignedXdr: shared, summary: { title: label, lines: [], estimatedFee: "0.00001 XLM" } },
    intent: INTENT,
    label,
  }));
  const submittedSequences: bigint[] = [];
  const approved: bigint[] = [];
  let current = 100n;
  const d = deps({
    // Mirrors `resequenceEnvelope`: load the current account sequence, set `current+1`.
    resequence: async (result) => {
      current += 1n;
      return { ...result, unsignedXdr: setSequence(result.unsignedXdr, PASSPHRASE, current) };
    },
    approver: {
      async approve(request) {
        approved.push(sequenceOf(request.unsignedXdr));
        return APPROVED;
      },
    },
    sign: async (outcome) => {
      submittedSequences.push(sequenceOf(outcome.result!.unsignedXdr));
      return submitted();
    },
  });

  const outcomes = await runTxSequence(steps, d);

  assert.equal(outcomes.length, 3);
  assert.ok(outcomes.every((outcome) => outcome.status === "submitted"));
  assert.deepEqual(submittedSequences, [101n, 102n, 103n]);
  assert.deepEqual(approved, [101n, 102n, 103n]);
});

test("a resequencing failure is labelled and never reaches the signer", async () => {
  let signed = 0;
  const d = deps({
    resequence: async () => {
      throw new Error("rpc unreachable");
    },
    sign: async () => {
      signed += 1;
      return submitted();
    },
    now: () => 9,
  });

  const outcomes = await runTxSequence([step("A"), step("B")], d);

  assert.deepEqual(outcomes, [
    { status: "failed", label: "A", detail: "Resequencing error: rpc unreachable", atMs: 9 },
  ]);
  assert.equal(signed, 0);
});

test("a step's lazy build() is preferred over its plan-time result", async () => {
  let built = 0;
  const seenXdr: string[] = [];
  const fresh = { unsignedXdr: `${UNSIGNED}-fresh`, summary: { title: "A", lines: [], estimatedFee: "0.00001 XLM" } };
  const stepA: TxRunStep = {
    result: RESULT,
    intent: INTENT,
    label: "A",
    build: async () => {
      built += 1;
      return fresh;
    },
  };
  const d = deps({
    sign: async (outcome) => {
      seenXdr.push(outcome.result!.unsignedXdr);
      return submitted();
    },
  });

  await runTxSequence([stepA], d);

  assert.equal(built, 1);
  assert.deepEqual(seenXdr, [fresh.unsignedXdr]);
});
