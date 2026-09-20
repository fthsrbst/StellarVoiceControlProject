import { Button } from "@/components/ui/button";
import type { ScheduleRow } from "@/lib/schedules";

/** Colour + text badge for a schedule's status (never colour alone). */
function StatusBadge({ row }: { row: ScheduleRow }) {
  const tone =
    row.status === "scheduled"
      ? "border-polaris-accent/50 text-polaris-accent"
      : row.status === "due"
        ? "border-polaris-ok/50 text-polaris-ok"
        : row.status === "delayed"
          ? "border-polaris-warn/50 text-polaris-warn"
          : "border-polaris-line text-polaris-muted";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${tone}`}>
      {row.statusLabel}
    </span>
  );
}

export interface ScheduleListProps {
  rows: readonly ScheduleRow[];
  loading: boolean;
  /** Id currently being cancelled, to disable its button. */
  busyId: number | null;
  onCancel: (row: ScheduleRow) => void;
}

/** The owner's upcoming schedules, each row with a Cancel button. */
export function ScheduleList({ rows, loading, busyId, onCancel }: ScheduleListProps) {
  if (loading) {
    return <p className="text-xs text-polaris-muted">Loading upcoming payments…</p>;
  }
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-polaris-line bg-polaris-panel/60 px-3 py-2 text-xs text-polaris-muted">
        No upcoming payments yet. Create one below, or say "her cuma 10:00'da acc2'ye 5 XLM gönder".
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.id} className="rounded-lg border border-polaris-line bg-polaris-panel/60 px-3 py-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                #{row.id} {row.amount} {row.asset} → {row.recipient}
              </p>
              <p className="mt-0.5 text-xs text-polaris-muted">
                {row.recurrence} · {row.runsLeft} run{row.runsLeft === 1 ? "" : "s"} left
              </p>
              <p className="mt-1 text-[11px] text-polaris-muted">
                Next: <span className="selectable text-polaris-text">{row.nextRunLocal}</span> local
              </p>
              <p className="text-[11px] text-polaris-muted">
                <span className="selectable text-polaris-text">{row.nextRunUtc}</span> UTC
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              <StatusBadge row={row} />
              <Button
                size="sm"
                variant="outline"
                disabled={busyId === row.id}
                onClick={() => onCancel(row)}
              >
                {busyId === row.id ? "Cancelling…" : "Cancel"}
              </Button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
