import { PanelNote, PanelShell } from "@/panels/PanelShell";

/**
 * Anchor panel skeleton.
 *
 * Presentation-only until its milestone lands: it renders no chain state and
 * moves no value. The SEP-10/38/6 deposit and withdraw flow arrives in
 * milestone 3.
 */
export function AnchorPanel() {
  return (
    <PanelShell title="Anchor" subtitle="Deposit and withdraw via an anchor">
      <PanelNote>
        Anchor on/off-ramp lands in milestone 3 — nothing moves value from this
        window yet.
      </PanelNote>
    </PanelShell>
  );
}
