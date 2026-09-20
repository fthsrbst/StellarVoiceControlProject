/**
 * Pure view model for the Suggestions panel (step W6c).
 *
 * Wraps the offline `@polaris/stellar` engine: it reads the owner's outgoing
 * payments, builds the engine's context (never auto-apply, D11) and formats the
 * result for the UI. Accepting a suggestion is a *navigation* decision — the
 * mapping to a panel and the clipboard draft live here so they are unit-tested.
 * Nothing here signs, submits or changes a rule.
 */
import { suggest } from "@polaris/stellar";

import type { PanelName } from "../panelRoutes.ts";

/** Testnet payments are XLM by default; the panel picks the busiest asset. */
export const DEFAULT_DISPLAY_ASSET = "XLM";

/** The asset the owner sent the most of in history, XLM breaking ties/clashes. */
export function pickDisplayAsset(records: readonly suggest.HistoryRecord[]): string {
  const counts = new Map<string, number>();
  for (const record of records) {
    counts.set(record.asset, (counts.get(record.asset) ?? 0) + 1);
  }
  if (counts.size === 0) return DEFAULT_DISPLAY_ASSET;
  return [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    if (a[0] === DEFAULT_DISPLAY_ASSET) return -1;
    if (b[0] === DEFAULT_DISPLAY_ASSET) return 1;
    return a[0].localeCompare(b[0]);
  })[0]![0];
}

export interface SuggestInputs {
  history: readonly suggest.HistoryRecord[];
  /** Unix seconds. Injected, never read from a clock inside the engine. */
  now: number;
  timeZone: string;
  displayAsset: string;
  dismissed: readonly string[];
  knownContacts?: readonly string[];
  autoPayEnabled?: boolean;
  autoPayEnabledSince?: number;
}

export interface SuggestRun {
  suggestions: suggest.Suggestion[];
  /** Why the engine returned nothing, or `null` when there was enough history. */
  noSuggestions: suggest.NoSuggestionsExplanation | null;
}

/** Builds the engine context. Auto-pay is off: no live guard rule is read here. */
export function buildSuggestContext(inputs: SuggestInputs): suggest.SuggestContext {
  const context: suggest.SuggestContext = {
    now: inputs.now,
    timeZone: inputs.timeZone,
    autoPayEnabled: inputs.autoPayEnabled ?? false,
    knownContacts: new Set(inputs.knownContacts ?? []),
    dismissed: new Set(inputs.dismissed),
    displayAsset: inputs.displayAsset,
  };
  if (inputs.autoPayEnabledSince !== undefined) context.autoPayEnabledSince = inputs.autoPayEnabledSince;
  return context;
}

/** Runs the pure engine once. Never throws on a malformed history record. */
export function computeSuggestions(inputs: SuggestInputs): SuggestRun {
  const context = buildSuggestContext(inputs);
  return {
    suggestions: suggest.suggest(inputs.history, context),
    noSuggestions: suggest.explainNoSuggestions(inputs.history, context),
  };
}

/**
 * The compact aggregate the UI shows under the rationale. Amounts are display
 * strings already; no address, alias or record id is ever included.
 */
export function describeEvidence(evidence: suggest.SuggestionEvidence): string {
  const parts = [
    `${evidence.windowDays} days`,
    `${evidence.count} payments`,
    `median ${evidence.median}`,
    `p90 ${evidence.p90}`,
    `max ${evidence.max}`,
  ];
  if (evidence.occurrences !== undefined && evidence.intervalDays !== undefined) {
    parts.push(`${evidence.occurrences} similar · every ~${evidence.intervalDays.toFixed(1)} days`);
  }
  if (evidence.unusedDays !== undefined) parts.push(`unused ${evidence.unusedDays} days`);
  if (evidence.ratio !== undefined) parts.push(`${evidence.ratio}× typical`);
  return parts.join(" · ");
}

/**
 * Which panel an accepted suggestion prefills. `null` means there is no
 * follow-up flow (an informational alert is simply acknowledged).
 */
export function acceptTarget(kind: suggest.SuggestionKind): PanelName | null {
  switch (kind) {
    case "auto_pay_threshold":
    case "daily_limit":
    case "tighten_dormant":
      return "security";
    case "schedule_from_recurrence":
      return "schedules";
    case "unusual_payment_alert":
      return null;
  }
}

/**
 * A short human draft the panel copies to the clipboard on Accept. It only
 * describes the change; it is never a signed or submittable artifact.
 */
export function suggestionDraft(suggestion: suggest.Suggestion): string {
  const change = suggestion.proposedChange;
  const header = `Suggested change (not applied): ${suggestion.title}`;
  return [header, JSON.stringify(change, null, 2)].join("\n");
}
