import { useCallback, useState } from "react";
import type { PolarisEvent } from "@polaris/interfaces";

import { usePolarisEvents } from "@/panels/events";
import { PanelNote, PanelShell } from "@/panels/PanelShell";

/** The `summary` an `approval_request` event carries, decoded from the unsigned XDR. */
type ApprovalSummary = Extract<PolarisEvent, { type: "approval_request" }>["summary"];

/**
 * Approval panel skeleton.
 *
 * It mirrors the latest `approval_request` for context only. The Approve / Deny
 * actions and the Touch ID gate that authorises them arrive with the signing
 * milestone — nothing here may move value or bypass the approval events, so the
 * card is deliberately presentation-only.
 */
export function ApprovalPanel() {
  const [summary, setSummary] = useState<ApprovalSummary | null>(null);

  const onEvent = useCallback((event: PolarisEvent) => {
    if (event.type === "approval_request") setSummary(event.summary);
  }, []);
  usePolarisEvents(onEvent);

  return (
    <PanelShell title="Approval" subtitle="Review the exact transaction before it is signed">
      <div className="space-y-4">
        <PanelNote>
          Approve / Deny and the Touch ID gate land in milestone W3. This card is
          read-only: it never signs, submits or approves anything, and it stays on
          the approval event stream rather than calling the chain directly.
        </PanelNote>
        {summary ? (
          <div className="space-y-2 rounded-lg border border-polaris-line bg-polaris-panel/60 p-3">
            <p className="text-sm font-medium">{summary.title}</p>
            <ul className="space-y-1 text-xs text-polaris-muted">
              {summary.lines.map((line) => (
                <li key={line} className="selectable">
                  {line}
                </li>
              ))}
            </ul>
            <p className="text-xs text-polaris-muted">
              Estimated fee: <span className="selectable">{summary.estimatedFee}</span>
            </p>
          </div>
        ) : (
          <p className="text-xs text-polaris-muted">No pending approval in this session.</p>
        )}
      </div>
    </PanelShell>
  );
}
