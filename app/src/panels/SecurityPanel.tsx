import { PanelNote, PanelShell } from "@/panels/PanelShell";

/**
 * Security panel skeleton.
 *
 * Presentation-only until its milestone lands: it renders no rule state and
 * moves no value. The spending rules and security profiles arrive in
 * milestone 3.
 */
export function SecurityPanel() {
  return (
    <PanelShell title="Security & rules" subtitle="Spending limits and approvals">
      <PanelNote>
        Security profiles and spending rules land in milestone 3 — this shell
        never handles a secret.
      </PanelNote>
    </PanelShell>
  );
}
