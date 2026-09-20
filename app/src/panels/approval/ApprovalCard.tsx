import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import type { ApprovalError, ApprovalMode, ApprovalSnapshot } from "../../lib/approval.ts";
import { EXPIRED_MESSAGE, type ApprovalStage } from "./approvalFlow.ts";
import { HashFingerprint } from "./HashFingerprint.tsx";
import { SummaryLines } from "./SummaryLines.tsx";

/** The mode's short, non-technical label. */
const MODE_LABEL: Record<ApprovalMode, string> = {
  touch_id: "Touch ID required",
  wallet_only: "Wallet signature required",
};

/** `1:05` for a minute or more, otherwise `9s`. */
function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, "0")}` : `${seconds}s`;
}

export interface ApprovalCardProps {
  stage: ApprovalStage;
  snapshot: ApprovalSnapshot | null;
  remainingMs: number | null;
  hint: string | null;
  error: ApprovalError | null;
  canApprove: boolean;
  demo: boolean;
  onApprove: () => void;
  onDeny: () => void;
}

/**
 * Presentation-only approval card. It owns no policy: what it may show and when
 * Approve is live come from `approvalFlow.ts`, so this file stays a pure view of
 * the state machine. Approve is always a deliberate click; Esc (and Deny) are
 * the only ways out, and neither signs anything.
 */
export function ApprovalCard({
  stage,
  snapshot,
  remainingMs,
  hint,
  error,
  canApprove,
  demo,
  onApprove,
  onDeny,
}: ApprovalCardProps) {
  const denyRef = useRef<HTMLDivElement>(null);
  const decided = stage === "pending" || stage === "authorizing";

  // Focus the safe choice by default: a stray Enter can only deny. The ref is on
  // the wrapper because the shared `Button` does not forward a ref.
  useEffect(() => {
    if (stage === "pending") denyRef.current?.querySelector("button")?.focus();
  }, [stage]);

  // Esc is a keyboard deny. Approving still needs an explicit click.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && decided) {
        event.preventDefault();
        onDeny();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decided, onDeny]);

  const message = (() => {
    switch (stage) {
      case "authorizing":
        return "Waiting for Touch ID…";
      case "authorized":
        return "Approved — waiting for the wallet to sign";
      case "denied":
        return "Denied";
      case "expired":
        return EXPIRED_MESSAGE;
      case "error":
        return error?.message ?? "Approval failed";
      default:
        return null;
    }
  })();

  return (
    <div role="group" aria-label="Transaction approval" className="space-y-4">
      {demo ? (
        <p
          role="note"
          className="rounded-md border border-polaris-warn/60 bg-polaris-warn/10 px-3 py-2 text-center text-xs font-semibold tracking-wide text-polaris-warn"
        >
          DEMO — nothing is signed
        </p>
      ) : null}

      {snapshot ? (
        <div className="space-y-3 rounded-lg border border-polaris-line bg-polaris-panel/60 p-3">
          <p className="text-lg font-semibold leading-tight">{snapshot.summary.title}</p>
          <SummaryLines lines={snapshot.summary.lines} />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-polaris-muted">
            <span>{MODE_LABEL[snapshot.mode]}</span>
            <span>
              Estimated fee:{" "}
              <span className="selectable font-mono text-polaris-text">
                {snapshot.summary.estimatedFee}
              </span>
            </span>
          </div>
          <div className="space-y-1">
            <span className="text-[10px] uppercase tracking-wide text-polaris-muted">
              Payload hash
            </span>
            <HashFingerprint hash={snapshot.payloadHash} />
          </div>
          {snapshot.summary.explorerUrl ? (
            <a
              href={snapshot.summary.explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-xs text-polaris-accent hover:underline"
            >
              View on explorer
            </a>
          ) : null}
        </div>
      ) : stage === "idle" ? (
        <p className="text-xs text-polaris-muted">No pending approval in this session.</p>
      ) : null}

      {remainingMs !== null && stage !== "expired" ? (
        <p className="text-xs text-polaris-muted" aria-live="off">
          Expires in <span className="font-mono text-polaris-text">{formatRemaining(remainingMs)}</span>
        </p>
      ) : null}

      {hint ? (
        <p className="rounded-md border border-polaris-line bg-polaris-panel-alt/60 px-3 py-2 text-xs text-polaris-muted">
          {hint}
        </p>
      ) : null}

      <p
        role={stage === "error" ? "alert" : "status"}
        aria-live="polite"
        className={
          stage === "authorized"
            ? "text-sm text-polaris-ok"
            : stage === "error"
              ? "text-sm text-polaris-danger"
              : "text-sm text-polaris-text"
        }
      >
        {message ?? ""}
      </p>

      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="md"
          className="flex-1"
          disabled={!canApprove}
          aria-busy={stage === "authorizing"}
          onClick={onApprove}
        >
          {stage === "authorizing" ? "Waiting for Touch ID…" : "Approve with Touch ID"}
        </Button>
        <div ref={denyRef} className="flex-1">
          <Button
            variant="outline"
            size="md"
            className="w-full"
            disabled={!decided}
            onClick={onDeny}
          >
            Deny
          </Button>
        </div>
      </div>
    </div>
  );
}
