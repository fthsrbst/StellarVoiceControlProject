/**
 * Real data for the notch Rules page.
 *
 * Mirrors the read-only half of `SecurityPanel`: it loads the owner's on-chain
 * guard state (`lib/guardStateLive`) and reduces it to the same label/value
 * read-back the panel shows (`stateLines`), plus the alias-book size. This page
 * never writes; every change goes through the Security panel (opened from the
 * notch) and the shared tx pipeline.
 *
 * `mapRulesView` is pure so it runs under `node:test`. Outside Tauri — and when
 * `stellar_config` has no owner — the page falls back to the explicit, labelled
 * mock demo. A real read that fails becomes `error` with a Retry, never mock.
 */
import { useCallback, useEffect, useState } from "react";

import { stateLines, type StateLine } from "../../lib/guardState.ts";
import { MOCK_RULES } from "../../lib/mockData.ts";
import type { SecurityLoad } from "@/lib/guardStateLive.ts";

/** Which of the page's five states is showing. */
export type RulesState = "loading" | "ready" | "unconfigured" | "not_set_up" | "error";

export interface RulesView {
  state: RulesState;
  /** Read-back lines, worded exactly like the Security panel. */
  lines: StateLine[];
  /** Why the guard is unavailable or the read failed; `""` otherwise. */
  detail: string;
  /** True when the rows are the labelled mock demo, not chain data. */
  demo: boolean;
}

export const RULES_LOADING: RulesView = {
  state: "loading",
  lines: [],
  detail: "",
  demo: false,
};

/** One-line alias-book summary for the read-back. */
function aliasLine(load: Extract<SecurityLoad, { kind: "ok" }>): StateLine {
  const saved = load.state.aliases.filter((alias) => alias.onChain !== null).length;
  const unreadable = load.state.aliases.filter((alias) => alias.status === "error").length;
  const value =
    saved > 0
      ? `${saved} saved${unreadable > 0 ? `, ${unreadable} unreadable` : ""}`
      : unreadable > 0
        ? `${unreadable} unreadable`
        : "none";
  return { label: "Saved contacts", value };
}

/** Pure: a decoded guard read -> the notch Rules summary. */
export function mapRulesView(load: SecurityLoad): RulesView {
  if (load.kind === "unconfigured") {
    return { ...RULES_LOADING, state: "unconfigured", detail: load.detail };
  }
  if (load.kind === "unreachable") {
    return { ...RULES_LOADING, state: "error", detail: load.detail };
  }
  if (load.state.rule === null) {
    return { ...RULES_LOADING, state: "not_set_up" };
  }
  return {
    state: "ready",
    lines: [...stateLines(load.state), aliasLine(load)],
    detail: "",
    demo: false,
  };
}

/** Explicit demo: the mock rules, labelled and read-only. */
export function demoRulesView(): RulesView {
  const lines: StateLine[] = MOCK_RULES.map((rule) => ({
    label: rule.name,
    value: rule.enabled ? rule.condition : `${rule.condition} (off)`,
  }));
  return { state: "ready", lines, detail: "", demo: true };
}

export interface RulesData extends RulesView {
  /** Re-read the guard state (the error state's Retry). */
  refresh: () => void;
}

/** Thin hook: one read on mount, re-run on `refresh()`. No polling. */
export function useRulesData(): RulesData {
  const [view, setView] = useState<RulesView>(RULES_LOADING);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    setView(RULES_LOADING);
    void loadRules().then((next) => {
      if (!cancelled) setView(next);
    });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  return { ...view, refresh };
}

/**
 * The real read or the labelled demo. The dynamic imports keep this module
 * loadable under `node:test` (which only needs the pure mapper) without pulling
 * Tauri in at import time.
 */
async function loadRules(): Promise<RulesView> {
  try {
    const [{ isTauri }, { getStellarConfig }, { loadSecurityState }] = await Promise.all([
      import("@tauri-apps/api/core"),
      import("@/lib/stellarConfig"),
      import("@/lib/guardStateLive"),
    ]);
    if (!isTauri()) return demoRulesView();
    const config = await getStellarConfig();
    if (!config.ownerAddress) return demoRulesView();
    return mapRulesView(await loadSecurityState());
  } catch (error) {
    return {
      ...RULES_LOADING,
      state: "error",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
