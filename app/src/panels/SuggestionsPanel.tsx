import { useCallback, useEffect, useMemo, useState } from "react";
import type { StellarConfig } from "@polaris/interfaces";

import { Button } from "@/components/ui/button";
import { fetchOwnerPayments, mapHistoryRecords, type PaymentsFetchResult } from "@/lib/history";
import { openPanel } from "@/lib/panels";
import { getStellarConfig } from "@/lib/stellarConfig";
import { PanelShell } from "@/panels/PanelShell";
import {
  acceptTarget,
  computeSuggestions,
  describeEvidence,
  pickDisplayAsset,
  suggestionDraft,
} from "@/panels/suggestions/suggestionsModel";
import {
  clearDismissals,
  dismissSuggestion,
  readDismissals,
} from "@/panels/suggestions/dismissals";
import { cn } from "@/lib/utils";

const CONFIDENCE_STYLES: Record<string, string> = {
  high: "border-polaris-ok/40 bg-polaris-ok/15 text-polaris-ok",
  medium: "border-polaris-warn/40 bg-polaris-warn/15 text-polaris-warn",
  low: "border-polaris-line bg-polaris-panel/60 text-polaris-muted",
};

/**
 * Suggestions panel (step W6c).
 *
 * Renders the offline engine's output for the owner's recent payments. A
 * suggestion is **never** auto-applied (D11): Accept only opens the relevant
 * panel and copies a draft text, Dismiss only remembers a local preference. No
 * data leaves the device and nothing here signs or submits.
 */
export function SuggestionsPanel() {
  const [config, setConfig] = useState<StellarConfig | null>(null);
  const [configured, setConfigured] = useState(false);
  const [payments, setPayments] = useState<PaymentsFetchResult | null>(null);
  const [dismissed, setDismissed] = useState<string[]>(() => readDismissals());
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getStellarConfig()
      .catch(() => null)
      .then((value) => {
        if (cancelled) return;
        setConfig(value);
        setConfigured(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!config?.ownerAddress) return;
    let cancelled = false;
    void fetchOwnerPayments(config.horizonUrl, config.ownerAddress, { limit: 50 }).then((result) => {
      if (!cancelled) setPayments(result);
    });
    return () => {
      cancelled = true;
    };
  }, [config]);

  const history = useMemo(
    () =>
      payments?.status === "ok" && config?.ownerAddress
        ? mapHistoryRecords(payments.payments, config.ownerAddress)
        : [],
    [config, payments],
  );

  const run = useMemo(() => {
    if (history.length === 0) return null;
    return computeSuggestions({
      history,
      now: Math.floor(Date.now() / 1000),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      displayAsset: pickDisplayAsset(history),
      dismissed,
    });
  }, [dismissed, history]);

  const dismiss = useCallback((value: string) => {
    setDismissed(dismissSuggestion(value));
  }, []);

  const accept = useCallback(async (kind: Parameters<typeof acceptTarget>[0], draft: string) => {
    const target = acceptTarget(kind);
    if (target === null) {
      setDismissed(dismissSuggestion(kind));
      setStatus("Marked as acknowledged.");
      return;
    }
    try {
      await navigator.clipboard.writeText(draft);
      setStatus(`Draft copied. Opening the ${target} panel — nothing is applied automatically.`);
    } catch {
      setStatus(`Opening the ${target} panel — nothing is applied automatically.`);
    }
    try {
      await openPanel(target);
    } catch (error: unknown) {
      console.warn("suggestions could not open a panel", error);
    }
  }, []);

  const suggestions = run?.suggestions ?? [];

  return (
    <PanelShell title="Suggestions" subtitle="Suggested payments and rules — never auto-applied">
      <div className="space-y-4">
        {configured && !config?.ownerAddress ? (
          <p className="rounded-lg border border-polaris-line bg-polaris-panel/60 px-3 py-2 text-xs text-polaris-muted">
            Set POLARIS_OWNER_ADDRESS to compute suggestions from your payments.
          </p>
        ) : null}

        {payments?.status === "offline" ? (
          <p className="rounded-lg border border-polaris-danger/40 bg-polaris-danger/10 px-3 py-2 text-xs text-polaris-danger">
            Horizon is unreachable: {payments.message}.
          </p>
        ) : null}

        {payments?.status === "not_found" ? (
          <p className="rounded-lg border border-polaris-warn/40 bg-polaris-warn/10 px-3 py-2 text-xs text-polaris-warn">
            This account is not funded on testnet yet, so there is no history.
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-polaris-muted">
            {suggestions.length > 0 ? `${suggestions.length} suggestion(s)` : ""}
          </span>
          {dismissed.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                clearDismissals();
                setDismissed([]);
                setStatus("Dismissals cleared.");
              }}
            >
              Clear dismissed
            </Button>
          ) : null}
        </div>

        {status ? <p className="text-xs text-polaris-muted">{status}</p> : null}

        {payments?.status === "ok" && history.length === 0 ? (
          <p className="rounded-lg border border-polaris-line bg-polaris-panel/60 px-3 py-2 text-xs text-polaris-muted">
            No outgoing payments in the recent history yet.
          </p>
        ) : null}

        {run?.noSuggestions ? (
          <p className="rounded-lg border border-polaris-line bg-polaris-panel/60 px-3 py-2 text-xs text-polaris-muted">
            Not enough history yet — {run.noSuggestions.count} of {run.noSuggestions.minPayments}{" "}
            payments over {run.noSuggestions.spanDays} of {run.noSuggestions.minSpanDays} days.
          </p>
        ) : null}

        {run && suggestions.length === 0 && run.noSuggestions === null ? (
          <p className="rounded-lg border border-polaris-line bg-polaris-panel/60 px-3 py-2 text-xs text-polaris-muted">
            No suggestions right now. Dismissing one hides it until you clear dismissals.
          </p>
        ) : null}

        <ul className="space-y-3">
          {suggestions.map((suggestion) => (
            <li
              key={suggestion.id}
              className="space-y-2 rounded-lg border border-polaris-line bg-polaris-panel/40 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    CONFIDENCE_STYLES[suggestion.confidence] ?? CONFIDENCE_STYLES.low,
                  )}
                >
                  {suggestion.confidence}
                </span>
                <span className="text-sm font-medium">{suggestion.title}</span>
              </div>
              <p className="text-xs leading-5 text-polaris-text">{suggestion.rationale}</p>
              <p className="text-[11px] text-polaris-muted">{describeEvidence(suggestion.evidence)}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void accept(suggestion.kind, suggestionDraft(suggestion))}
                >
                  Accept
                </Button>
                <Button variant="ghost" size="sm" onClick={() => dismiss(suggestion.id)}>
                  Dismiss
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </PanelShell>
  );
}
