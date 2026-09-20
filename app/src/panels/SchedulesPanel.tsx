import { PanelNote, PanelShell } from "@/panels/PanelShell";

/**
 * Schedules panel skeleton.
 *
 * Presentation-only until its milestone lands: it renders no schedule state and
 * moves no value. The upcoming-payments list with Cancel arrives in
 * milestone 3.
 */
export function SchedulesPanel() {
  return (
    <PanelShell title="Schedules" subtitle="Upcoming payments">
      <PanelNote>
        Scheduled payments land in milestone 3 — nothing is cancelled or
        submitted from this window yet.
      </PanelNote>
    </PanelShell>
  );
}
