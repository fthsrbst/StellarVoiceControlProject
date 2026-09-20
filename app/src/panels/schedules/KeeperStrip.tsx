import { keeperStatus, type ScheduleRow } from "@/lib/schedules";

/**
 * The keeper status strip. It explains, in plain words, that an untrusted
 * off-chain program must trigger due schedules, shows how to start one, and how
 * soon the next run is. **It never starts a process** — the command is only
 * displayed for the user to run.
 */
export function KeeperStrip({ rows }: { rows: readonly ScheduleRow[] }) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const first = rows[0];
  const nextDueSeconds = first ? Math.floor(Date.parse(first.nextRunUtc) / 1000) : null;
  const status = keeperStatus({ hasSchedules: rows.length > 0, nextDueSeconds, nowSeconds });

  return (
    <section
      className={`rounded-lg border px-3 py-2 text-xs leading-5 ${
        status.needed
          ? "border-polaris-warn/50 bg-polaris-warn/10 text-polaris-text"
          : "border-polaris-line bg-polaris-panel/60 text-polaris-muted"
      }`}
    >
      <p className="font-medium">{status.needed ? "Keeper required" : "No keeper needed"}</p>
      <p className="mt-0.5 text-polaris-muted">{status.headline}</p>
      <p className="mt-1">
        Start one with{" "}
        <code className="selectable rounded bg-black/30 px-1 py-0.5 font-mono text-[11px] text-polaris-accent">
          {status.command}
        </code>
      </p>
      <p className="mt-0.5 text-polaris-muted">Polaris never starts the keeper for you.</p>
    </section>
  );
}
