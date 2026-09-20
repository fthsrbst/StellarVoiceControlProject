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
export type PanelName =
  | "wallet"
  | "approval"
  | "security"
  | "schedules"
  | "suggestions"
  | "anchor"
  | "p2p"
  | "privacy"
  | "settings"
  | "debug";

export const PANEL_NAMES: readonly PanelName[] = [
  "wallet",
  "approval",
  "security",
  "schedules",
  "suggestions",
  "anchor",
  "p2p",
  "privacy",
  "settings",
  "debug",
];

/** A parsed window route: either the notch overlay, or one panel. */
export type PanelRoute = { kind: "notch" } | { kind: "panel"; panel: PanelName };

/**
 * The approval card's fixture variants, selected by `?demo=…` on its hash. The
 * card is the only panel with a demo mode so far.
 */
export type ApprovalDemo = "live" | "expired" | "error";

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

/**
 * Reads the approval card's `demo` query parameter out of a hash.
 *
 * Returns `null` — real mode — unless the hash names the approval panel **and**
 * carries a recognised `demo` value, so a real window can never fall into a
 * fixture by accident. `1`, `true` and an empty value all mean the live demo;
 * unknown values stay real.
 */
export function parseApprovalDemo(hash: string): ApprovalDemo | null {
  const route = parsePanelRoute(hash);
  if (route.kind !== "panel" || route.panel !== "approval") return null;
  const query = hash.split("?")[1];
  if (query === undefined) return null;
  const value = new URLSearchParams(query).get("demo");
  if (value === null) return null;
  switch (value.toLowerCase()) {
    case "":
    case "1":
    case "true":
      return "live";
    case "expired":
      return "expired";
    case "error":
      return "error";
    default:
      return null;
  }
}
