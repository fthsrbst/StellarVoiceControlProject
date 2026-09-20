/**
 * Panel routing.
 *
 * Every window loads the same `index.html`; Rust puts the panel route in the
 * URL hash (`index.html#/wallet`, see `app/src-tauri/src/panels.rs`). The
 * no-hash case is the notch overlay, so the overlay's behaviour is unchanged.
 *
 * This module is deliberately pure: no DOM, no Tauri, just the string in and the
 * typed route out, so the hash grammar is unit-testable.
 */

/**
 * Panels that exist. Must match the Rust allow-list one-for-one. This union is
 * the frontend's single source of truth: `@/lib/panels` re-exports it rather
 * than declaring a second list, so adding a panel is one edit here.
 */
export type PanelName = "wallet" | "approval" | "settings";

export const PANEL_NAMES: readonly PanelName[] = ["wallet", "approval", "settings"];

/** A parsed window route: either the notch overlay, or one panel. */
export type PanelRoute = { kind: "notch" } | { kind: "panel"; panel: PanelName };

/** True when `value` names a panel. */
export function isPanelName(value: string): value is PanelName {
  return (PANEL_NAMES as readonly string[]).includes(value);
}

/**
 * Parses a `window.location.hash` into a route.
 *
 * Tolerated around the name: a missing `#`, leading/trailing slashes, a query
 * string, and letter case. Anything that is not a known panel falls back to the
 * notch, so an unknown or malformed hash can never open a blank window.
 */
export function parsePanelRoute(hash: string): PanelRoute {
  const withoutHash = hash.startsWith("#") ? hash.slice(1) : hash;
  const path = withoutHash.split("?")[0] ?? "";
  const name = path.replace(/^\/+/, "").replace(/\/+$/, "").toLowerCase();
  return isPanelName(name) ? { kind: "panel", panel: name } : { kind: "notch" };
}
