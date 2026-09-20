/**
 * The Anchor panel's flow hook (W5b).
 *
 * It owns the `AnchorSession` (built with the shell signer) and forwards the
 * session's explain records into the panel's state and the TTS narrator. The
 * decision logic lives in `steps.ts`; this file is the imperative glue between
 * React and the chain lane.
 *
 * Nothing here signs or submits directly: the session drives the injected
 * signer, which routes a sequence-0 login challenge to the wallet-only Rust
 * command and everything else through the shared Touch ID pipeline.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { anchor } from "@polaris/stellar";

import { createAnchorSession } from "@/lib/anchor";
import { speakSentence } from "@/lib/speech";
import {
  anchorFlowReducer,
  createFlowState,
  stepForExplain,
  type AnchorStepId,
} from "@/panels/anchor/steps";

/** Which way the money is moving. */
export type AnchorDirection = "deposit" | "withdraw";

/** What the panel renders and the actions it can trigger. */
export interface AnchorFlow {
  state: ReturnType<typeof createFlowState>;
  busy: boolean;
  direction: AnchorDirection;
  setDirection: (direction: AnchorDirection) => void;
  discovery: anchor.AnchorToml | null;
  quoteLines: string[];
  instruction: string | null;
  orderId: string | null;
  orderStatus: string | null;
  txHash: string | null;
  explorerUrl: string | null;
  narrate: boolean;
  setNarrate: (value: boolean) => void;
  discover: () => Promise<void>;
  start: (amount: string) => Promise<void>;
  simulateBank: () => Promise<void>;
  poll: () => Promise<void>;
}

function messageOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0]?.trim() || "The anchor step failed.";
}

/** Human lines from a SEP-38 quote found. */
function quoteLines(quote: anchor.Quote): string[] {
  return [
    `${quote.sellAmount} ${quote.sellAsset} → about ${quote.buyAmount} ${quote.buyAsset}`,
    quote.feeTotal
      ? `anchor fee ${quote.feeTotal} ${quote.feeAsset ?? quote.sellAsset}`
      : "no separate fee quoted",
  ];
}

/**
 * Words the SEP-6 response into one line the user can act on. The anchor text
 * arrives sanitised from the client; it is shown as the anchor's words.
 */
function describeInstructions(
  kind: AnchorDirection,
  data: anchor.DepositInstructions | anchor.WithdrawInstructions,
): string {
  if (kind === "withdraw") {
    const w = data as anchor.WithdrawInstructions;
    return `Pay ${w.accountId}${w.memo ? ` with memo ${w.memo.type}:${w.memo.value}` : ""}`;
  }
  const d = data as anchor.DepositInstructions;
  if (d.how) return d.how;
  if (d.instructions) {
    return Object.entries(d.instructions)
      .map(([field, value]) => `${field}: ${value.value}`)
      .join(" · ");
  }
  return "Follow the anchor's bank transfer instructions.";
}

export function useAnchorFlow(): AnchorFlow {
  const [state, dispatch] = useReducer(anchorFlowReducer, undefined, createFlowState);
  const [busy, setBusy] = useState(false);
  const [direction, setDirection] = useState<AnchorDirection>("deposit");
  const [discovery, setDiscovery] = useState<anchor.AnchorToml | null>(null);
  const [quote, setQuote] = useState<string[]>([]);
  const [instruction, setInstruction] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderStatus, setOrderStatus] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [explorerUrl, setExplorerUrl] = useState<string | null>(null);
  const [narrate, setNarrate] = useState(true);

  const sessionRef = useRef<anchor.AnchorSession | null>(null);
  const amountRef = useRef("");
  const narrateRef = useRef(narrate);
  narrateRef.current = narrate;
  const directionRef = useRef(direction);
  directionRef.current = direction;

  const session = useCallback((): anchor.AnchorSession => {
    sessionRef.current ??= createAnchorSession();
    return sessionRef.current;
  }, []);

  useEffect(() => {
    const s = session();
    return s.explain.subscribe((record) => {
      dispatch({ type: "log", line: { step: record.step, what: record.what, why: record.why, at: record.at } });
      const id = stepForExplain(record.step, directionRef.current);
      if (id) dispatch({ type: "step", id, status: "done" });
      if (narrateRef.current) speakSentence(anchor.narrate(record));
    });
  }, [session]);

  const runStep = useCallback(
    async <T,>(id: AnchorStepId, fn: () => Promise<T>): Promise<T> => {
      dispatch({ type: "step", id, status: "active" });
      try {
        const result = await fn();
        dispatch({ type: "step", id, status: "done" });
        return result;
      } catch (error) {
        dispatch({ type: "error", message: messageOf(error) });
        throw error;
      }
    },
    [],
  );

  const discover = useCallback(async () => {
    try {
      setDiscovery((await runStep("discover", () => session().discover())).data);
    } catch {
      // The failure is already in the state.
    }
  }, [runStep, session]);

  const start = useCallback(
    async (amount: string) => {
      if (busy) return;
      setBusy(true);
      dispatch({ type: "reset" });
      amountRef.current = amount;
      setOrderId(null);
      setOrderStatus(null);
      setTxHash(null);
      setExplorerUrl(null);
      setInstruction(null);
      setQuote([]);
      try {
        const s = session();
        await runStep("discover", async () => setDiscovery((await s.discover()).data));
        const found = direction === "deposit" ? await s.quoteDeposit(amount) : await s.quoteWithdraw(amount);
        setQuote(quoteLines(found.data));
        await runStep("auth", () => s.login());
        const pre = await runStep("account", () => s.prepareAccount());
        // The trustline step is done only when one was actually added; an account
        // that already trusts the asset never reaches that step.
        if (pre.data.actions.includes("trustline_created")) {
          dispatch({ type: "step", id: "trustline", status: "done" });
        }
        const order =
          direction === "deposit"
            ? await runStep("deposit", () => s.startDeposit(amount))
            : await runStep("deposit", () => s.startWithdraw(amount));
        setOrderId(order.data.id);
        setInstruction(describeInstructions(direction, order.data));
        dispatch({ type: "step", id: "waiting", status: "active" });
        if (direction === "withdraw") {
          const paid = await runStep("waiting", () => s.payWithdrawal(amount));
          setTxHash(paid.data.hash);
          setExplorerUrl(paid.data.explorerUrl);
        }
      } catch (error) {
        // `runStep` already recorded the message; a throw outside a step (the
        // SEP-38 quote) would otherwise be silent.
        dispatch({ type: "error", message: messageOf(error) });
      } finally {
        setBusy(false);
      }
    },
    [busy, direction, runStep, session],
  );

  const simulateBank = useCallback(async () => {
    if (!orderId || busy) return;
    setBusy(true);
    try {
      await runStep("waiting", () => session().simulateBank(orderId, amountRef.current));
    } catch (error) {
      dispatch({ type: "error", message: messageOf(error) });
    } finally {
      setBusy(false);
    }
  }, [busy, orderId, runStep, session]);

  const poll = useCallback(async () => {
    if (!orderId || busy) return;
    setBusy(true);
    try {
      const { data } = await runStep("waiting", () =>
        session().waitForTransaction(orderId, { timeoutMs: 30_000, intervalMs: 2_000 }),
      );
      setOrderStatus(String(data.tx.status));
      if (data.outcome === "completed") {
        dispatch({ type: "step", id: "completed", status: "done" });
        if (data.tx.stellarTransactionId) {
          setExplorerUrl(`https://stellar.expert/explorer/testnet/tx/${data.tx.stellarTransactionId}`);
        }
      }
    } catch (error) {
      dispatch({ type: "error", message: messageOf(error) });
    } finally {
      setBusy(false);
    }
  }, [busy, orderId, runStep, session]);

  return {
    state,
    busy,
    direction,
    setDirection,
    discovery,
    quoteLines: quote,
    instruction,
    orderId,
    orderStatus,
    txHash,
    explorerUrl,
    narrate,
    setNarrate,
    discover,
    start,
    simulateBank,
    poll,
  };
}
