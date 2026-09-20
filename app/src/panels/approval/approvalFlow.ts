/**
 * Pure approval-card state machine (no React, no Tauri, no timers).
 *
 * The card is a small, security-sensitive state machine: it decides when the
 * Approve button may fire and when the request is dead. Keeping that decision
 * here — and out of the component — makes it fully unit-testable
 * (`approvalFlow.test.ts`) and keeps the presentation layer from inventing its
 * own notion of "still pending".
 *
 * States: `idle -> pending -> authorizing -> authorized | denied | expired`,
 * plus a terminal `error`. Every transition is fail-closed: only `pending`
 * admits an approve click, and any snapshot state this machine does not
 * recognise lands in `error`, where Approve is disabled.
 */
import type {
  ApprovalError,
  ApprovalErrorKind,
  ApprovalSnapshot,
} from "../../lib/approval.ts";

/** Terminal/transient stages the card renders. */
export type ApprovalStage =
  | "idle"
  | "pending"
  | "authorizing"
  | "authorized"
  | "denied"
  | "expired"
  | "error";

/** Shown when the user dismisses the Touch ID prompt without deciding. */
export const CANCELLED_HINT = "Touch ID cancelled — you can try again";

/** Shown when the request's `expiresAtMs` has passed. */
export const EXPIRED_MESSAGE = "This request expired — ask again by voice";

/**
 * A snapshot this machine can render. `error` is the one stage that tolerates a
 * missing snapshot: a failed hydration has nothing to show but the message.
 */
export type ApprovalFlowState =
  | { readonly stage: "idle" }
  | {
      readonly stage: "pending";
      readonly snapshot: ApprovalSnapshot;
      readonly nowMs: number;
      readonly hint: string | null;
    }
  | {
      readonly stage: "authorizing";
      readonly snapshot: ApprovalSnapshot;
      readonly nowMs: number;
    }
  | { readonly stage: "authorized"; readonly snapshot: ApprovalSnapshot }
  | { readonly stage: "denied"; readonly snapshot: ApprovalSnapshot }
  | { readonly stage: "expired"; readonly snapshot: ApprovalSnapshot }
  | {
      readonly stage: "error";
      readonly snapshot: ApprovalSnapshot | null;
      readonly error: ApprovalError;
    };

/** Every way the card can be driven. `nowMs` is always injected, never read here. */
export type ApprovalAction =
  | {
      readonly type: "snapshot";
      readonly snapshot: ApprovalSnapshot | null;
      readonly nowMs: number;
    }
  | { readonly type: "snapshotFailed"; readonly error: ApprovalError }
  | { readonly type: "approveClicked" }
  | { readonly type: "denyClicked" }
  | { readonly type: "authorizeOk"; readonly snapshot: ApprovalSnapshot }
  | {
      readonly type: "authorizeFailed";
      readonly kind: ApprovalErrorKind;
      readonly message?: string;
    }
  | { readonly type: "tick"; readonly nowMs: number }
  | { readonly type: "result"; readonly payloadHash: string; readonly approved: boolean };

/** The card opens on `idle` until `approval_current()` answers. */
export function initialApprovalState(): ApprovalFlowState {
  return { stage: "idle" };
}

/**
 * Maps a snapshot's own state onto a stage. `consumed` is a snapshot that was
 * already authorised and used, so it renders as `authorized`; an unrecognised
 * state is a contract drift and fails closed into `error`.
 */
function fromSnapshot(snapshot: ApprovalSnapshot, nowMs: number): ApprovalFlowState {
  switch (snapshot.state) {
    case "pending":
      return nowMs >= snapshot.expiresAtMs
        ? { stage: "expired", snapshot }
        : { stage: "pending", snapshot, nowMs, hint: null };
    case "authorized":
    case "consumed":
      return { stage: "authorized", snapshot };
    case "denied":
      return { stage: "denied", snapshot };
    case "expired":
      return { stage: "expired", snapshot };
    default:
      return {
        stage: "error",
        snapshot,
        error: {
          kind: "failed",
          message: `Unknown approval state: ${String((snapshot as { state?: unknown }).state)}`,
        },
      };
  }
}

/** Default copy for a failure kind, when Rust sent no message. */
function messageFor(kind: ApprovalErrorKind, message: string | undefined): string {
  if (message !== undefined && message.length > 0) return message;
  switch (kind) {
    case "unavailable":
      return "Touch ID is unavailable on this device";
    case "timeout":
      return "Touch ID timed out — try again";
    case "expired":
      return EXPIRED_MESSAGE;
    case "notPending":
      return "This request is no longer waiting for approval";
    default:
      return "Touch ID failed — approval denied";
  }
}

/** The single reducer behind the card. */
export function reduceApproval(
  state: ApprovalFlowState,
  action: ApprovalAction,
): ApprovalFlowState {
  switch (action.type) {
    case "snapshot":
      return action.snapshot === null
        ? { stage: "idle" }
        : fromSnapshot(action.snapshot, action.nowMs);

    case "snapshotFailed":
      return { stage: "error", snapshot: null, error: action.error };

    case "approveClicked":
      // Only a live pending request may start the Touch ID gesture; while
      // authorizing (or in any terminal stage) a second click is a no-op.
      if (state.stage !== "pending") return state;
      if (state.nowMs >= state.snapshot.expiresAtMs) {
        return { stage: "expired", snapshot: state.snapshot };
      }
      return { stage: "authorizing", snapshot: state.snapshot, nowMs: state.nowMs };

    case "denyClicked":
      // Deny is the safe action, so it stays available while authorizing too.
      if (state.stage === "pending" || state.stage === "authorizing") {
        return { stage: "denied", snapshot: state.snapshot };
      }
      return state;

    case "authorizeOk":
      return { stage: "authorized", snapshot: action.snapshot };

    case "authorizeFailed": {
      // A stale failure from a superseded attempt must not move the card.
      if (state.stage !== "authorizing") return state;
      if (action.kind === "cancelled") {
        if (state.nowMs >= state.snapshot.expiresAtMs) {
          return { stage: "expired", snapshot: state.snapshot };
        }
        return {
          stage: "pending",
          snapshot: state.snapshot,
          nowMs: state.nowMs,
          hint: CANCELLED_HINT,
        };
      }
      if (action.kind === "expired") {
        return { stage: "expired", snapshot: state.snapshot };
      }
      return {
        stage: "error",
        snapshot: state.snapshot,
        error: { kind: action.kind, message: messageFor(action.kind, action.message) },
      };
    }

    case "tick": {
      if (state.stage !== "pending" && state.stage !== "authorizing") return state;
      if (action.nowMs >= state.snapshot.expiresAtMs) {
        return { stage: "expired", snapshot: state.snapshot };
      }
      return { ...state, nowMs: action.nowMs };
    }

    case "result": {
      // The event stream is global: a result for a different payloadHash is not
      // this card's outcome and must be ignored.
      const snapshot = state.stage === "idle" ? null : state.snapshot;
      if (snapshot === null || snapshot.payloadHash !== action.payloadHash) return state;
      return action.approved
        ? { stage: "authorized", snapshot }
        : { stage: "denied", snapshot };
    }
  }
}

/** True only for a live pending request whose deadline has not passed. */
export function canApprove(state: ApprovalFlowState): boolean {
  return state.stage === "pending" && state.nowMs < state.snapshot.expiresAtMs;
}

/** Milliseconds left on the countdown, or `null` outside a bounded stage. */
export function remainingMs(state: ApprovalFlowState): number | null {
  if (state.stage !== "pending" && state.stage !== "authorizing") return null;
  return Math.max(0, state.snapshot.expiresAtMs - state.nowMs);
}

/** True while the Touch ID gesture is in flight. */
export function isAuthorizing(state: ApprovalFlowState): boolean {
  return state.stage === "authorizing";
}

/** The snapshot to render, if any. */
export function currentSnapshot(state: ApprovalFlowState): ApprovalSnapshot | null {
  return state.stage === "idle" ? null : state.snapshot;
}
