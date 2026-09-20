/**
 * Scheduled payments readiness (milestone W6b).
 *
 * Read-only: it checks that the guard is configured, that the owner's schedule
 * list is readable (the `listUpcoming` path the panel uses), how many schedules
 * exist, and whether the two things a run needs are present — a published guard
 * rule and a non-zero SAC allowance. It never creates, cancels or signs
 * anything, and never runs the keeper.
 */
import { summarizeScheduleHealth } from "@/lib/schedules";
import { gatherScheduleHealth } from "@/lib/schedulesLive";
import { errorDetail, makeResult } from "@/debug/runner.ts";
import type { FeatureCheck } from "@/debug/types.ts";

export default {
  id: "schedules",
  title: "Scheduled payments",
  milestone: "W6",
  async run() {
    try {
      const { status, detail } = summarizeScheduleHealth(await gatherScheduleHealth());
      return makeResult(status, detail);
    } catch (error) {
      return makeResult("fail", `schedules check failed: ${errorDetail(error)}`);
    }
  },
} satisfies FeatureCheck;
