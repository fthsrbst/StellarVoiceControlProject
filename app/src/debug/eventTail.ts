/**
 * Shared event tail for the Debug panel (step W0b).
 *
 * The panel renders the last [`TAIL_LIMIT`] `polaris-event`s and some checks read
 * the most recent event of a type (the hotkey check needs the last
 * `hotkey_permission` value). Both go through this module-level ring so the
 * subscription lives in one place.
 *
 * Webviews do not share a JS context, so this is a per-window tail; that is
 * exactly what a panel-local debug view wants.
 */
import type { PolarisEvent } from "@polaris/interfaces";

/** How many events the tail keeps. Beyond this the oldest is dropped. */
export const TAIL_LIMIT = 50;

let tail: PolarisEvent[] = [];

/** Appends one event, dropping the oldest once the tail is full. */
export function recordEvent(event: PolarisEvent): void {
  tail.push(event);
  if (tail.length > TAIL_LIMIT) {
    tail = tail.slice(tail.length - TAIL_LIMIT);
  }
}

/** The events currently in the tail, oldest first. */
export function eventsInTail(): readonly PolarisEvent[] {
  return tail;
}

/** The most recent event of `type`, or `null` if none is in the tail. */
export function lastEvent<T extends PolarisEvent["type"]>(
  type: T,
): Extract<PolarisEvent, { type: T }> | null {
  for (let index = tail.length - 1; index >= 0; index -= 1) {
    const event = tail[index];
    if (event && event.type === type) {
      return event as Extract<PolarisEvent, { type: T }>;
    }
  }
  return null;
}

/** Empties the tail. Exists for test isolation; the panel never calls it. */
export function clearEventTail(): void {
  tail = [];
}
