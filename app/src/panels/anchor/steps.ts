/**
 * The Anchor panel's pure view model (W5b).
 *
 * All of the panel's decisions live here — the step list, the flow reducer and
 * the amount validation — so they can be unit-tested under `node:test` without a
 * DOM or Tauri. The component only renders this state and calls the session.
 */

/** The ordered steps a deposit/withdraw flow goes through. */
export type AnchorStepId =
  | "discover"
  | "auth"
  | "account"
  | "trustline"
  | "deposit"
  | "waiting"
  | "completed";

/** How a step is doing. */
export type StepStatus = "pending" | "active" | "done" | "error";

/** One row of the step list. */
export interface AnchorStep {
  id: AnchorStepId;
  title: string;
}

/** The step list, in order, shown for both directions. */
export const ANCHOR_STEPS: readonly AnchorStep[] = [
  { id: "discover", title: "Discover anchor (SEP-1)" },
  { id: "auth", title: "Sign in (SEP-10)" },
  { id: "account", title: "Prepare account (fund + inspect)" },
  { id: "trustline", title: "Add USDC trustline" },
  { id: "deposit", title: "Anchor order (SEP-6)" },
  { id: "waiting", title: "Waiting for the anchor / bank" },
  { id: "completed", title: "Completed" },
];

/** A single explain-log line, structurally the anchor client's `ExplainRecord`. */
export interface ExplainLine {
  step: string;
  what: string;
  why: string;
  at?: string;
}

/** The panel's whole view state. */
export interface AnchorFlowState {
  steps: Record<AnchorStepId, StepStatus>;
  log: ExplainLine[];
  error: string | null;
}

export type AnchorFlowAction =
  | { type: "step"; id: AnchorStepId; status: StepStatus }
  | { type: "log"; line: ExplainLine }
  | { type: "error"; message: string }
  | { type: "reset" };

/** Every step starts pending. */
export function createFlowState(): AnchorFlowState {
  const steps = {} as Record<AnchorStepId, StepStatus>;
  for (const step of ANCHOR_STEPS) steps[step.id] = "pending";
  return { steps, log: [], error: null };
}

/** The reducer behind the step list and the explain log. Pure. */
export function anchorFlowReducer(
  state: AnchorFlowState,
  action: AnchorFlowAction,
): AnchorFlowState {
  switch (action.type) {
    case "step":
      return { ...state, steps: { ...state.steps, [action.id]: action.status } };
    case "log":
      return { ...state, log: [...state.log, action.line] };
    case "error":
      return { ...state, error: action.message };
    case "reset":
      return createFlowState();
  }
}

/**
 * Best-effort mapping from an explain record's `step` label to the panel step it
 * belongs to. The flow advances its steps explicitly; this only lets a step tick
 * as soon as the session narrates it. A `sep6.*` order explain belongs to the
 * order step on a deposit but to the waiting step on a withdraw; a plain
 * `horizon.*` read (e.g. a balance check) belongs to no step.
 */
export function stepForExplain(
  step: string,
  direction: "deposit" | "withdraw" = "deposit",
): AnchorStepId | undefined {
  if (step.startsWith("sep10")) return "auth";
  if (step === "sep1" || step.startsWith("sep1.")) return "discover";
  if (step === "preflight.trustline") return "trustline";
  if (step.startsWith("preflight")) return "account";
  if (step.startsWith("sep12") || step.startsWith("sep38")) return "deposit";
  if (step.startsWith("sep6")) return direction === "withdraw" ? "waiting" : "deposit";
  return undefined;
}

/* ------------------------------------------------------------------ *
 * Amount validation
 * ------------------------------------------------------------------ */

/** The mock treasury is shared, so the panel keeps demo amounts small. */
export const DEPOSIT_MIN = 50;
export const DEPOSIT_MAX = 100;
export const WITHDRAW_MIN = 1;
export const WITHDRAW_MAX = 100;
export const SHARED_TREASURY_NOTE =
  "Shared testnet treasury: keep amounts small (50-100 TRY).";

export type AmountCheck =
  | { ok: true; amount: string }
  | { ok: false; message: string };

function checkAmount(raw: string, kind: "deposit" | "withdraw"): AmountCheck {
  const amount = raw.trim();
  if (!/^\d+(?:\.\d+)?$/.test(amount) || !/[1-9]/.test(amount)) {
    return { ok: false, message: "Enter a positive number." };
  }
  const value = Number(amount);
  const [min, max] = kind === "deposit" ? [DEPOSIT_MIN, DEPOSIT_MAX] : [WITHDRAW_MIN, WITHDRAW_MAX];
  const unit = kind === "deposit" ? "TRY" : "USDC";
  if (value < min) {
    return { ok: false, message: `Minimum is ${min} ${unit}.` };
  }
  if (value > max) {
    return { ok: false, message: `Keep it between ${min} and ${max} ${unit} (shared treasury).` };
  }
  return { ok: true, amount };
}

/** Validates the deposit amount (TRY). */
export function validateDepositAmount(raw: string): AmountCheck {
  return checkAmount(raw, "deposit");
}

/** Validates the withdrawal amount (on-chain USDC). */
export function validateWithdrawAmount(raw: string): AmountCheck {
  return checkAmount(raw, "withdraw");
}
