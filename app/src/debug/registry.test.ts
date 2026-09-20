import assert from "node:assert/strict";
import { test } from "node:test";

import { collectChecks, compareChecks } from "./registry.ts";
import type { CheckResult, FeatureCheck } from "./types.ts";

function check(id: string, milestone: FeatureCheck["milestone"]): FeatureCheck {
  return {
    id,
    title: id,
    milestone,
    run: async (): Promise<CheckResult> => ({ status: "ok", detail: id, checkedAt: 1 }),
  };
}

test("checks are ordered by milestone, then id", () => {
  const modules = {
    "./checks/zeta.ts": { default: check("zeta", "W0") },
    "./checks/alpha.ts": { default: check("alpha", "W3") },
    "./checks/beta.ts": { default: check("beta", "W0") },
  };
  assert.deepEqual(
    collectChecks(modules).map((entry) => entry.id),
    ["beta", "zeta", "alpha"],
  );
});

test("milestone order is numeric, so W10 sorts after W3", () => {
  const modules = {
    "./checks/ten.ts": { default: check("ten", "W10") },
    "./checks/three.ts": { default: check("three", "W3") },
  };
  assert.deepEqual(
    collectChecks(modules).map((entry) => entry.milestone),
    ["W3", "W10"],
  );
});

test("a module without a usable default becomes a failing entry, not a crash", () => {
  const modules = {
    "./checks/good.ts": { default: check("good", "W0") },
    "./checks/empty.ts": {},
    "./checks/wrong.ts": { default: { id: "no-run" } },
    "./checks/notamodule.ts": 42,
  };
  const checks = collectChecks(modules);
  assert.equal(checks.length, 4);

  const malformed = checks.filter((entry) => entry.id.startsWith("malformed:"));
  assert.equal(malformed.length, 3);
  for (const entry of malformed) {
    assert.equal(entry.milestone, "W0");
  }
  assert.ok(checks.some((entry) => entry.id === "good"));
});

test("a malformed entry reports a fail when run", async () => {
  const [entry] = collectChecks({ "./checks/broken.ts": {} });
  assert.ok(entry);
  const result = await entry.run();
  assert.equal(result.status, "fail");
  assert.match(result.detail, /broken\.ts does not default-export/);
});

test("compareChecks is a stable tie-breaker by id", () => {
  assert.ok(compareChecks(check("a", "W1"), check("b", "W1")) < 0);
  assert.equal(compareChecks(check("a", "W1"), check("a", "W1")), 0);
});
