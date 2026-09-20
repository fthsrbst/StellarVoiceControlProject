/**
 * Guard / security-rules readiness (milestone W6a).
 *
 * It builds nothing and moves nothing: it reads the guard client's view state
 * live and maps it to one honest line — the guard contract id is configured, the
 * rule is readable, and the executor state. An account that has no rule yet is a
 * `warn` ("not set up"), a missing `GUARD_CONTRACT_ID` is a `warn`, and an RPC
 * failure is a `fail`. The decision logic is pure and lives in
 * `@/lib/guardState`; this file only wires the live read to it.
 */
import { isArmed, profileModeOf, stateLines } from "@/lib/guardState.ts";
import { loadSecurityState } from "@/lib/guardStateLive.ts";
import { makeResult } from "@/debug/runner.ts";
import type { FeatureCheck } from "@/debug/types.ts";

/** The live check. Read-only; safe for the panel's auto-run. */
export default {
  id: "security",
  title: "Guard rules & allowance",
  milestone: "W6",
  async run() {
    const loaded = await loadSecurityState();
    if (loaded.kind === "unconfigured") {
      return makeResult("warn", `${loaded.detail}; the Security panel cannot read the rule`);
    }
    if (loaded.kind === "unreachable") {
      return makeResult("fail", `guard is not reachable: ${loaded.detail}`);
    }

    const { state } = loaded;
    const guard = `${state.guardContractId.slice(0, 6)}…${state.guardContractId.slice(-4)}`;
    if (state.rule === null) {
      return makeResult(
        "warn",
        `guard ${guard} is reachable but this owner has no rule yet (not set up)`,
      );
    }
    const threshold = stateLines(state).find((line) => line.label === "Auto-approve")?.value ?? "0";
    const executor = isArmed(state) ? "executor armed" : "no executor (always ask)";
    const profile = profileModeOf(state) === "always_ask" ? "Always ask" : "Auto under limit";
    return makeResult(
      "ok",
      `guard ${guard} · ${profile} · threshold ${threshold} · ${executor}`,
    );
  },
} satisfies FeatureCheck;
