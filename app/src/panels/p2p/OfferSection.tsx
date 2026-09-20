import type { Offer } from "@polaris/stellar";

import { OfferRow } from "@/panels/p2p/OfferRow";
import type { OfferView, P2pAction } from "@/lib/p2pView";

/** A raw offer paired with its formatted view, as the panel computes them. */
export interface OfferRowModel {
  offer: Offer;
  view: OfferView;
}

export interface OfferSectionProps {
  title: string;
  rows: OfferRowModel[];
  busy: boolean;
  onAction: (offer: Offer, action: P2pAction) => void;
}

/** A titled list of offer rows; renders nothing when the list is empty. */
export function OfferSection({ title, rows, busy, onAction }: OfferSectionProps) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-polaris-muted">
        {title}
      </h3>
      <ul className="space-y-2">
        {rows.map((row) => (
          <OfferRow
            key={`${title}-${row.view.id.toString()}`}
            view={row.view}
            busy={busy}
            onAction={(action) => onAction(row.offer, action)}
          />
        ))}
      </ul>
    </div>
  );
}
