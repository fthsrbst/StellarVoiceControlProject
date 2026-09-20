import { ApprovalPanel } from "@/panels/ApprovalPanel";
import { SettingsPanel } from "@/panels/SettingsPanel";
import { WalletPanel } from "@/panels/WalletPanel";
import type { PanelName } from "@/panels/panelRoutes";

/**
 * Maps a parsed route to its panel component. This is the only place the route
 * union and the components meet, so adding a panel means: registry entry in
 * `app/src-tauri/src/panels.rs`, a name in `panelRoutes.ts`, and a case here.
 */
export function PanelRoot({ panel }: { panel: PanelName }) {
  switch (panel) {
    case "wallet":
      return <WalletPanel />;
    case "approval":
      return <ApprovalPanel />;
    case "settings":
      return <SettingsPanel />;
  }
}
