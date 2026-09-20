import { AnchorPanel } from "@/panels/AnchorPanel";
import { ApprovalPanel } from "@/panels/ApprovalPanel";
import { DebugPanel } from "@/panels/DebugPanel";
import { P2pPanel } from "@/panels/P2pPanel";
import { PrivacyPanel } from "@/panels/PrivacyPanel";
import { SchedulesPanel } from "@/panels/SchedulesPanel";
import { SecurityPanel } from "@/panels/SecurityPanel";
import { SettingsPanel } from "@/panels/SettingsPanel";
import { SuggestionsPanel } from "@/panels/SuggestionsPanel";
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
    case "security":
      return <SecurityPanel />;
    case "schedules":
      return <SchedulesPanel />;
    case "suggestions":
      return <SuggestionsPanel />;
    case "anchor":
      return <AnchorPanel />;
    case "p2p":
      return <P2pPanel />;
    case "privacy":
      return <PrivacyPanel />;
    case "settings":
      return <SettingsPanel />;
    case "debug":
      return <DebugPanel />;
  }
}
