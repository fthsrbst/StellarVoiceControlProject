import assert from "node:assert/strict";
import { test } from "node:test";

import { makePayloadFixture } from "./fixtures.ts";
import type { BridgeResult } from "./types.ts";

test("a payload fixture survives a JSON round-trip unchanged", () => {
  const { payload } = makePayloadFixture();
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), payload);
});

test("a success result discriminates on ok", () => {
  const result: BridgeResult = {
    ok: true,
    signedXdr: "AAAA",
    signerAddress: "G…",
  };
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.signedXdr, "AAAA");
});

test("a failure result carries the posted code", () => {
  const result: BridgeResult = {
    ok: false,
    code: "address_mismatch",
    error: "connected address does not match",
  };
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "address_mismatch");
});
