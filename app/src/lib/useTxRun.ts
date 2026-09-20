/**
 * `useTxRun` — the React face of `@/lib/txPipeline` for panel components (W0d).
 *
 * The hook owns only the run lifecycle; all chain work lives in `txPipeline.ts`
 * (and, below it, the real approver/signing seams). The reducer is a pure
 * exported function so it can be tested without a DOM (`useTxRun.test.ts`).
 *
 * A panel calls `run(steps)` from a button, renders `progress` while `state` is
 * `running`, and reads `outcomes` once it is `done`. `reset()` returns to idle.
 */
import { useCallback, useReducer } from "react";

import {
  runTxSequence,
  type TxPhase,
  type TxPipelineDeps,
  type TxProgress,
  type TxRunOutcome,
  type TxRunStep,
} from "./txPipeline.ts";

/** Where a run is in its lifecycle. */
export type TxRunState = "idle" | "running" | "done";

/** A progress tick, mirroring the `TxProgress` callback's arguments. */
export interface TxProgressView {
  index: number;
  total: number;
  label: string;
  phase: TxPhase;
}

/** The whole view the hook exposes. */
export interface TxRunView {
  state: TxRunState;
  /** The latest progress tick, or `null` before the first step starts. */
  progress: TxProgressView | null;
  outcomes: readonly TxRunOutcome[];
}

export const INITIAL_TX_RUN: TxRunView = { state: "idle", progress: null, outcomes: [] };

export type TxRunAction =
  | { type: "start"; total: number }
  | { type: "progress"; progress: TxProgressView }
  | { type: "outcomes"; outcomes: TxRunOutcome[] }
  | { type: "reset" };

/** Pure lifecycle reducer; exported for testing. */
export function txRunReducer(state: TxRunView, action: TxRunAction): TxRunView {
  switch (action.type) {
    case "start":
      return { state: "running", progress: null, outcomes: [] };
    case "progress":
      return { ...state, progress: action.progress };
    case "outcomes":
      return { state: "done", progress: state.progress, outcomes: action.outcomes };
    case "reset":
      return INITIAL_TX_RUN;
  }
}

/** The hook's return shape. */
export interface UseTxRun {
  state: TxRunState;
  progress: TxProgressView | null;
  outcomes: readonly TxRunOutcome[];
  run: (steps: readonly TxRunStep[]) => Promise<TxRunOutcome[]>;
  reset: () => void;
}

/** Drives `runTxSequence`, exposing its progress and outcomes as React state. */
export function useTxRun(deps?: Partial<TxPipelineDeps>): UseTxRun {
  const [view, dispatch] = useReducer(txRunReducer, INITIAL_TX_RUN);

  const run = useCallback(
    async (steps: readonly TxRunStep[]): Promise<TxRunOutcome[]> => {
      dispatch({ type: "start", total: steps.length });
      const onProgress: TxProgress = (index, total, label, phase) =>
        dispatch({ type: "progress", progress: { index, total, label, phase } });
      const outcomes = await runTxSequence(steps, deps, onProgress);
      dispatch({ type: "outcomes", outcomes });
      return outcomes;
    },
    [deps],
  );

  const reset = useCallback(() => dispatch({ type: "reset" }), []);

  return { state: view.state, progress: view.progress, outcomes: view.outcomes, run, reset };
}
