import { useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * "Create offer" form for the P2P panel.
 *
 * It only collects the seller's inputs (token amount and the asking TRY price)
 * and hands them to the panel, which builds the unsigned escrow call and runs it
 * through the shared tx pipeline. The form itself touches no chain.
 */
export interface OfferFormProps {
  busy: boolean;
  onCreate: (amount: string, priceTry: string) => void;
}

export function OfferForm({ busy, onCreate }: OfferFormProps) {
  const [amount, setAmount] = useState("");
  const [priceTry, setPriceTry] = useState("");

  const valid = /^\d+(\.\d{1,7})?$/.test(amount) && /[1-9]/.test(amount) && /^\d+(\.\d{1,2})?$/.test(priceTry);

  const submit = () => {
    if (!valid || busy) return;
    onCreate(amount.trim(), priceTry.trim());
    setAmount("");
    setPriceTry("");
  };

  return (
    <form
      className="rounded-lg border border-polaris-line bg-polaris-panel/60 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <p className="text-xs font-semibold text-polaris-text">Create offer — sell USDC for TRY</p>
      <div className="mt-2 flex items-end gap-2">
        <label className="flex-1 text-[11px] text-polaris-muted">
          Amount (USDC)
          <input
            className="mt-1 w-full rounded-md border border-polaris-line bg-black/30 px-2 py-1.5 text-xs text-polaris-text outline-none focus-visible:ring-2 focus-visible:ring-polaris-accent/60"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="100"
            inputMode="decimal"
          />
        </label>
        <label className="flex-1 text-[11px] text-polaris-muted">
          Price (TRY)
          <input
            className="mt-1 w-full rounded-md border border-polaris-line bg-black/30 px-2 py-1.5 text-xs text-polaris-text outline-none focus-visible:ring-2 focus-visible:ring-polaris-accent/60"
            value={priceTry}
            onChange={(event) => setPriceTry(event.target.value)}
            placeholder="3400"
            inputMode="decimal"
          />
        </label>
        <Button type="submit" size="sm" disabled={!valid || busy}>
          Create
        </Button>
      </div>
      <p className="mt-2 text-[11px] leading-4 text-polaris-muted">
        Your tokens are locked in escrow until a buyer pays the TRY off-chain and you confirm it.
      </p>
    </form>
  );
}
