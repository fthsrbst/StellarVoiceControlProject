import { PanelNote, PanelShell } from "@/panels/PanelShell";

/**
 * Suggestions panel skeleton.
 *
 * Presentation-only until its milestone lands: it renders no suggestions and
 * changes no rule. The suggestions engine's Accept/Dismiss surface arrives in
 * milestone 3.
 */
export function SuggestionsPanel() {
  return (
    <PanelShell title="Suggestions" subtitle="Suggested payments and rules">
      <PanelNote>
        Suggestions land in milestone 3 — they are never auto-applied from this
        window.
      </PanelNote>
    </PanelShell>
  );
}
