import { useCallback, useState } from "react";
import type { PolarisEvent } from "@polaris/interfaces";

import { Button } from "@/components/ui/button";
import { openPanel } from "@/lib/panels";
import { usePolarisEvents } from "@/panels/events";
import { PanelNote, PanelShell } from "@/panels/PanelShell";

/**
 * Wallet panel skeleton.
 *
 * Intentionally read-only: it renders no chain state and moves no value. The
 * real balances, aliases and history arrive in milestone W1; until then it shows
 * that the window opens, is focusable and receives the typed event stream.
 */
export function WalletPanel() {
  const [lastTx, setLastTx] = useState<string | null>(null);

  const onEvent = useCallback((event: PolarisEvent) => {
    if (event.type === "tx_submitted") setLastTx(event.hash);
  }, []);
  usePolarisEvents(onEvent);

  return (
    <PanelShell title="Wallet" subtitle="Balances, aliases and transaction history">
      <div className="space-y-4">
        <PanelNote>
          Wallet contents land in milestone W1. This is the interactive shell: it
          proves panel windows open from the tray and the <code>open_panel</code>{" "}
          command, and that they receive the same typed event stream as the notch.
        </PanelNote>
        <dl className="space-y-1 text-xs">
          <dt className="text-polaris-muted">Latest transaction</dt>
          <dd className="selectable break-all font-mono">
            {lastTx ?? "None in this session"}
          </dd>
        </dl>
        {/* Also demonstrates the typed wrapper for opening another panel. */}
        <Button variant="secondary" size="sm" onClick={() => void openPanel("settings")}>
          Open settings
        </Button>
      </div>
    </PanelShell>
  );
}
