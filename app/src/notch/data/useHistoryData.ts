/**
 * History page data (NW4): the owner's recent on-chain payments merged with the
 * local voice-turn log.
 *
 * Demo fallback is explicit and narrow: the mock timeline is shown **only** when
 * the app is not running inside Tauri or `stellar_config` has no owner address.
 * A failed real read never falls back to mock — it surfaces the error (with a
 * Retry action) so the page cannot quietly show fabricated history.
 *
 * Reads are read-only and happen on panel open and on an explicit Refresh; there
 * is no polling. Nothing here signs or moves value.
 */
import { useCallback, useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";

import {
  buildAliasEntries,
  fetchOwnerPayments,
  mapWalletTransactions,
} from "@/lib/history";
import { MOCK_HISTORY } from "@/lib/mockData";
import { getStellarConfig } from "@/lib/stellarConfig";
import { clearTurnLog, readTurnLog } from "@/lib/turnLog";
import {
  chainToRow,
  mergeHistory,
  turnsToRows,
  type HistoryEntryView,
} from "./historyModel";
import committedAliases from "../../../../stellar/config/aliases.json";

/** How many recent payments the timeline reads. */
const PAYMENT_LIMIT = 20;

/** Where the displayed timeline came from. */
export type HistorySource = "live" | "demo";

export interface HistoryData {
  entries: HistoryEntryView[];
  /** `demo` only when Tauri is absent or no owner address is configured. */
  source: HistorySource;
  loading: boolean;
  /** A real-read failure, shown with Retry (never replaced by mock data). */
  error: string | null;
  refresh: () => void;
  /** Clears the local turn log and reloads the timeline. */
  clearLocal: () => void;
}

/** The mock timeline, tagged for the view model. */
function demoEntries(): HistoryEntryView[] {
  return MOCK_HISTORY.map((entry) => ({ ...entry, explorerUrl: null }));
}

function messageOf(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return raw.split("\n")[0]?.trim() || "History could not be read";
}

export function useHistoryData(): HistoryData {
  const [entries, setEntries] = useState<HistoryEntryView[]>([]);
  const [source, setSource] = useState<HistorySource>("demo");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      // Local turns are a real source regardless of chain configuration.
      const turnRows = turnsToRows(readTurnLog());
      const showDemo = (): void => {
        if (cancelled) return;
        setEntries(demoEntries());
        setSource("demo");
        setLoading(false);
      };

      if (!isTauri()) {
        showDemo();
        return;
      }

      let config;
      try {
        config = await getStellarConfig();
      } catch (readError) {
        if (!cancelled) {
          setEntries(turnRows);
          setSource("live");
          setError(messageOf(readError));
          setLoading(false);
        }
        return;
      }
      if (!config.ownerAddress) {
        showDemo();
        return;
      }

      const payments = await fetchOwnerPayments(config.horizonUrl, config.ownerAddress, {
        limit: PAYMENT_LIMIT,
      });
      if (cancelled) return;
      if (payments.status === "offline") {
        setEntries(turnRows);
        setSource("live");
        setError(payments.message);
        setLoading(false);
        return;
      }
      const rows =
        payments.status === "ok"
          ? mapWalletTransactions(payments.payments, {
              ownerAddress: config.ownerAddress,
              aliasEntries: buildAliasEntries(config.aliases, committedAliases),
            }).map(chainToRow)
          : [];
      setEntries(mergeHistory(turnRows, rows));
      setSource("live");
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const refresh = useCallback(() => setReloadKey((key) => key + 1), []);
  const clearLocal = useCallback(() => {
    clearTurnLog();
    setReloadKey((key) => key + 1);
  }, []);

  return { entries, source, loading, error, refresh, clearLocal };
}
