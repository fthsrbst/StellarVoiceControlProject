import { useCallback, useEffect, useState } from "react";

import { deviceTimeZone, toScheduleRows, type ScheduleRow } from "@/lib/schedules";
import { loadUpcoming } from "@/lib/schedulesLive";

export interface SchedulesState {
  rows: ScheduleRow[];
  loading: boolean;
  /** Human error from the last load, or `null`. */
  error: string | null;
  /** The zone the local times are rendered in (the device's). */
  timeZone: string;
  refresh: () => void;
}

/**
 * Owns the panel's list lifecycle: load the owner's upcoming schedules, expose a
 * `refresh` the panel calls after a create/cancel. All chain access is in
 * `@/lib/schedulesLive`; this hook only holds React state.
 */
export function useSchedules(): SchedulesState {
  const timeZone = deviceTimeZone();
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadUpcoming(timeZone)
      .then((upcoming) => {
        if (cancelled) return;
        setRows(toScheduleRows(upcoming));
        setError(null);
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        setRows([]);
        setError(failure instanceof Error ? failure.message : String(failure));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [timeZone, nonce]);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);
  return { rows, loading, error, timeZone, refresh };
}
