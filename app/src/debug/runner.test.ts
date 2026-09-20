import assert from "node:assert/strict";
import { test } from "node:test";

import { runAll, runCheck } from "./runner.ts";
import type { CheckResult, FeatureCheck } from "./types.ts";

function check(
  id: string,
  run: () => Promise<CheckResult>,
  milestone: FeatureCheck["milestone"] = "W0",
): FeatureCheck {
  return { id, title: id, milestone, run };
}

test("a well-formed result passes through with its status and detail", async () => {
  const result = await runCheck(
    check("ok-check", async () => ({ status: "ok", detail: "all good", checkedAt: 1 })),
  );
  assert.equal(result.status, "ok");
  assert.equal(result.detail, "all good");
  assert.equal(result.checkedAt, 1);
});

test("a synchronous throw becomes a fail with a one-line detail", async () => {
  const result = await runCheck(
    check("boom", () => {
      throw new Error("first line\nsecond line that must not leak");
    }),
  );
  assert.equal(result.status, "fail");
  assert.equal(result.detail, "first line");
});

test("a rejected promise becomes a fail", async () => {
  const result = await runCheck(check("reject", () => Promise.reject(new Error("nope"))));
  assert.equal(result.status, "fail");
  assert.equal(result.detail, "nope");
});

test("a hung check is failed by the timeout, not left pending", async () => {
  const result = await runCheck(check("hang", () => new Promise<CheckResult>(() => {})), 20);
  assert.equal(result.status, "fail");
  assert.match(result.detail, /timed out after 20 ms/);
});

test("a malformed result is normalised to a scrubbed fail", async () => {
  const result = await runCheck(
    check("malformed", async () => ({ status: "bogus", detail: "key sk-abcdefghij" } as unknown as CheckResult)),
  );
  assert.equal(result.status, "fail");
  assert.equal(result.detail, "key [redacted]");
});

test("details are scrubbed on every path", async () => {
  const seed = `S${"A".repeat(55)}`;
  const result = await runCheck(
    check("secret", async () => ({
      status: "warn",
      detail: `seed ${seed}`,
      checkedAt: Date.now(),
    })),
  );
  assert.equal(result.status, "warn");
  assert.ok(!result.detail.includes("SAAAA"), result.detail);
  assert.ok(result.detail.includes("[redacted]"), result.detail);
});

test("runAll keeps every check even when some fail", async () => {
  const results = await runAll([
    check("a", async () => ({ status: "ok", detail: "a", checkedAt: 1 })),
    check("b", () => Promise.reject(new Error("b failed"))),
    check("c", async () => ({ status: "ok", detail: "c", checkedAt: 1 })),
  ]);
  assert.deepEqual(
    results.map((entry) => entry.check.id),
    ["a", "b", "c"],
  );
  assert.equal(results[0]?.result.status, "ok");
  assert.equal(results[1]?.result.status, "fail");
  assert.equal(results[2]?.result.status, "ok");
});

test("runAll preserves input order regardless of completion order", async () => {
  const slow = check("slow", async () => {
    await new Promise((resolve) => setTimeout(resolve, 15));
    return { status: "ok", detail: "slow", checkedAt: 1 };
  });
  const fast = check("fast", async () => ({ status: "ok", detail: "fast", checkedAt: 1 }));
  const results = await runAll([slow, fast], { concurrency: 2 });
  assert.deepEqual(
    results.map((entry) => entry.check.id),
    ["slow", "fast"],
  );
});

test("runAll never exceeds the concurrency bound", async () => {
  let active = 0;
  let peak = 0;
  const make = (id: string) =>
    check(id, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return { status: "ok", detail: id, checkedAt: 1 };
    });

  const results = await runAll(
    ["a", "b", "c", "d", "e"].map((id) => make(id)),
    { concurrency: 2 },
  );
  assert.equal(results.length, 5);
  assert.ok(peak <= 2, `peak concurrency was ${peak}`);
  assert.ok(peak >= 2, "the bound should actually be used");
});

// Fixture only: no check ships an action yet. Locks the contract that an action
// is an explicit self-test the runner never triggers on its own.
test("a check may carry side-effecting actions that runAll never runs", async () => {
  let actionRuns = 0;
  const withAction: FeatureCheck = {
    id: "with-action",
    title: "with action",
    milestone: "W3",
    run: async () => ({ status: "ok", detail: "checked", checkedAt: 1 }),
    actions: [
      {
        id: "self-test",
        label: "Test Touch ID",
        description: "Shows the Touch ID prompt; has a visible side effect.",
        run: async () => {
          actionRuns += 1;
          return { status: "ok", detail: "prompted", checkedAt: 1 };
        },
      },
    ],
  };

  const results = await runAll([withAction]);
  assert.equal(actionRuns, 0, "runAll must not run actions");
  assert.equal(results[0]?.result.detail, "checked");
  assert.equal(withAction.actions?.[0]?.label, "Test Touch ID");
});
