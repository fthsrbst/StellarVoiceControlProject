/**
 * Dismissed-suggestion persistence (step W6c).
 *
 * A dismissal is a local UI preference, never a rule change (D11), so it lives
 * in `localStorage` and is best-effort: private mode, a full quota or corrupt
 * JSON must never break the panel. The store is injectable so it is unit-tested
 * without a DOM.
 */

/** The `localStorage` key holding the dismissed ids and kinds. */
export const DISMISSALS_STORAGE_KEY = "polaris.suggestions.dismissed";

/** The slice of `Storage` this module needs; injectable for tests. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/** `window.localStorage`, or `undefined` when storage is blocked. */
export function defaultStorage(): StorageLike | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function parse(raw: string | null): string[] {
  if (raw === null) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((entry): entry is string => typeof entry === "string"))];
  } catch {
    return [];
  }
}

/** Reads the dismissed ids/kinds, tolerating a missing or corrupt value. */
export function readDismissals(storage: StorageLike | undefined = defaultStorage()): string[] {
  if (!storage) return [];
  try {
    return parse(storage.getItem(DISMISSALS_STORAGE_KEY));
  } catch {
    return [];
  }
}

/** Adds one id/kind to the dismissed set and returns the new full set. */
export function dismissSuggestion(
  value: string,
  storage: StorageLike | undefined = defaultStorage(),
): string[] {
  const next = [...new Set([...readDismissals(storage), value])];
  if (storage) {
    try {
      storage.setItem(DISMISSALS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Best effort: a failed write only means the dismissal is not remembered.
    }
  }
  return next;
}

/** Clears every dismissal. */
export function clearDismissals(storage: StorageLike | undefined = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem?.(DISMISSALS_STORAGE_KEY);
  } catch {
    // Best effort.
  }
}
