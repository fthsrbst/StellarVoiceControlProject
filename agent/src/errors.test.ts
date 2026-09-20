/**
 * F4: the refusal-code → short-label mapping.
 *
 * Every `PaymentRefusalCode` the chain can throw must resolve to a specific
 * label, so a failure is never reported as the generic "Chain error".
 */
import test from "node:test";
import assert from "node:assert/strict";

import { REFUSAL_LABELS, refusalLabel } from "./errors.ts";

/** The exact `PaymentRefusalCode` union from `stellar/src/payments/sendPayment.ts`. */
const PAYMENT_REFUSAL_CODES = [
  "not_configured",
  "invalid_intent",
  "invalid_amount",
  "unsupported_asset",
  "unknown_recipient",
  "mode_not_supported",
  "guarded_route_not_available",
  "recipient_no_trustline",
  "trustline_check_failed",
  "account_not_found",
  "guard_rule_missing",
  "guard_limit_exceeded",
  "guard_asset_not_allowed",
  "guard_client_error",
] as const;

test("every payment refusal code maps to a short, specific label", () => {
  for (const code of PAYMENT_REFUSAL_CODES) {
    const label = REFUSAL_LABELS[code];
    assert.ok(label, `no label for refusal code "${code}"`);
    assert.notEqual(label, "Chain error", `"${code}" must not fall back to the generic label`);
    assert.ok(label.length <= 40, `"${code}" label is too long: ${label}`);
  }
});

test("the common refusals read clearly in the notch", () => {
  assert.equal(refusalLabel("unknown_recipient"), "I don't know that recipient");
  assert.equal(refusalLabel("unsupported_asset"), "Asset not supported");
  assert.equal(refusalLabel("invalid_amount"), "Invalid amount");
  assert.equal(refusalLabel("account_not_found"), "Account not funded");
});

test("an unknown or absent code keeps the generic fallback", () => {
  assert.equal(refusalLabel("something_new"), "Chain error");
  assert.equal(refusalLabel(undefined), "Chain error");
  assert.equal(refusalLabel(undefined, "Custom"), "Custom");
});
