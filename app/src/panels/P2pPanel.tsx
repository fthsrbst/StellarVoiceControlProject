import { PanelNote, PanelShell } from "@/panels/PanelShell";

/**
 * P2P panel skeleton.
 *
 * Presentation-only until its milestone lands: it renders no escrow state and
 * moves no value. P2P escrow is a milestone 4 bonus, so this window may stay a
 * placeholder for the whole hackathon.
 */
export function P2pPanel() {
  return (
    <PanelShell title="P2P" subtitle="Peer-to-peer escrow">
      <PanelNote>
        P2P escrow is a milestone 4 bonus — nothing moves value from this window
        yet.
      </PanelNote>
    </PanelShell>
  );
}
