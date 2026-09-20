import { Button } from "@/components/ui/button";
import { actionHint, actionLabel, type OfferView, type P2pAction } from "@/lib/p2pView";

/** Colour for each offer state; the badge always carries text too. */
const STATE_STYLE: Record<string, string> = {
  Open: "bg-polaris-accent/20 text-polaris-accent",
  Accepted: "bg-amber-400/15 text-amber-300",
  Settled: "bg-emerald-400/15 text-emerald-300",
  Cancelled: "bg-white/10 text-polaris-muted",
  Expired: "bg-polaris-danger/15 text-polaris-danger",
};

const ROLE_LABEL: Record<OfferView["role"], string> = {
  seller: "your offer",
  buyer: "your trade",
  other: "",
};

const ACTIONABLE: readonly P2pAction[] = ["accept", "confirm", "cancel", "reclaim"];

export interface OfferRowProps {
  view: OfferView;
  busy: boolean;
  onAction: (action: P2pAction) => void;
}

/** One offer, with the single action the viewer may take next. */
export function OfferRow({ view, busy, onAction }: OfferRowProps) {
  const role = ROLE_LABEL[view.role];
  const actionable = ACTIONABLE.includes(view.next);
  return (
    <li className="rounded-lg border border-polaris-line bg-polaris-panel/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-polaris-text">Offer #{view.id.toString()}</span>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATE_STYLE[view.state] ?? "bg-white/10"}`}
          >
            {view.state}
          </span>
          {role ? <span className="text-[10px] text-polaris-muted">({role})</span> : null}
        </div>
        <span className="text-[10px] text-polaris-muted">{view.expiresIn}</span>
      </div>
      <p className="mt-1.5 text-xs text-polaris-text">
        {view.amount} USDC for <span className="font-medium">{view.priceTry} TRY</span>
      </p>
      <p className="text-[10px] text-polaris-muted">
        {view.rate} · seller {view.sellerLabel}
        {view.buyer ? ` · buyer ${view.buyer.slice(0, 4)}…${view.buyer.slice(-4)}` : ""}
      </p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[10px] leading-4 text-polaris-muted">{actionHint(view.next, view.state)}</span>
        {actionable ? (
          <Button
            size="sm"
            variant={view.next === "cancel" || view.next === "reclaim" ? "danger" : "default"}
            disabled={busy}
            onClick={() => onAction(view.next)}
          >
            {actionLabel(view.next)}
          </Button>
        ) : null}
      </div>
    </li>
  );
}
