import { lastEvent } from "../eventTail.ts";
import { makeResult } from "../runner.ts";
import type { FeatureCheck } from "../types.ts";

/**
 * Accessibility trust for the modifier-only Control+Option gesture.
 *
 * Rust emits `hotkey_permission` at startup and whenever trust changes, so the
 * check reads the most recent one from the event tail. Before any event is seen
 * it reports `unknown` and tells the owner how to produce one — running the
 * command directly would report trust without proving the gesture was
 * exercised. `Control+Option+Space` needs no permission and always works.
 */
export default {
  id: "hotkey",
  title: "Push-to-talk permission",
  milestone: "W0",
  async run() {
    const permission = lastEvent("hotkey_permission");
    if (!permission) {
      return makeResult("unknown", "hold Control+Option once, then run again");
    }
    return permission.trusted
      ? makeResult("ok", "Accessibility granted; Control+Option starts capture")
      : makeResult(
          "warn",
          "Accessibility not granted; Control+Option+Space works until it is",
        );
  },
} satisfies FeatureCheck;
