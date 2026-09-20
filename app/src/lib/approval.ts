/**
 * The shell's typed seam onto the Rust approval gate (milestone W3).
 *
 * The approval commands are implemented in Rust; this module is the only place
 * the webview names them, so the wire contract stays in one file. It mirrors the
 * seam pattern of `@/lib/polaris`: every command is a thin `invoke` wrapper, and
 * a rejected command is normalised into a typed `ApprovalError` rather than an
 * unknown rejection the UI would have to introspect.
 *
 * `invoke` is injected so the wrappers are unit-testable with a mocked command
 * (`approval.test.ts`); production callers use the default Tauri `invoke`.
 */
import { invoke } from "@tauri-apps/api/core";
import type { ChainToolResult, Intent } from "@polaris/interfaces";

/** How the user must approve: a Touch ID prompt, or a wallet signature. */
export type ApprovalMode = "touch_id" | "wallet_only";

/** The lifecycle of one pending approval, as the Rust store reports it. */
export type ApprovalState = "pending" | "authorized" | "denied" | "expired" | "consumed";

/**
 * Everything the card needs to render one approval. Deliberately **never**
 * carries the unsigned XDR — the card shows the decoded summary only, and the
 * XDR stays in Rust until a real gesture authorises it.
 */
export interface ApprovalSnapshot {
  id: string;
  payloadHash: string;
  summary: ChainToolResult["summary"];
  intent: Intent;
  mode: ApprovalMode;
  state: ApprovalState;
  /** Unix epoch milliseconds; the card marks the request expired at this instant. */
  expiresAtMs: number;
}

/** The typed failure union every approval command rejects with. */
export type ApprovalErrorKind =
  | "cancelled"
  | "failed"
  | "unavailable"
  | "timeout"
  | "expired"
  | "notPending";

export interface ApprovalError {
  kind: ApprovalErrorKind;
  message: string;
}

const APPROVAL_ERROR_KINDS: readonly ApprovalErrorKind[] = [
  "cancelled",
  "failed",
  "unavailable",
  "timeout",
  "expired",
  "notPending",
];

/** True when `value` is already a normalised `ApprovalError`. */
export function isApprovalError(value: unknown): value is ApprovalError {
  if (typeof value !== "object" || value === null) return false;
  const { kind, message } = value as { kind?: unknown; message?: unknown };
  return (
    typeof kind === "string" &&
    (APPROVAL_ERROR_KINDS as readonly string[]).includes(kind) &&
    typeof message === "string"
  );
}

/**
 * Normalises any rejection into an `ApprovalError`.
 *
 * Rust serialises its typed error as `{ kind, message }`, so a structured
 * rejection is trusted as-is when its `kind` is known; anything else (a string,
 * a transport failure, an unrecognised kind) becomes `failed`, which is
 * fail-closed: an unknown failure can never be mistaken for a successful
 * approval or a benign cancel.
 */
export function toApprovalError(error: unknown): ApprovalError {
  if (typeof error === "object" && error !== null) {
    const { kind, message } = error as { kind?: unknown; message?: unknown };
    if (typeof kind === "string" && (APPROVAL_ERROR_KINDS as readonly string[]).includes(kind)) {
      return {
        kind: kind as ApprovalErrorKind,
        message:
          typeof message === "string" && message.length > 0
            ? message
            : "Approval failed",
      };
    }
  }
  const detail = typeof error === "string" ? error : "";
  return { kind: "failed", message: detail.length > 0 ? detail : "Approval failed" };
}

/**
 * The subset of Tauri's `invoke` the wrappers use. Injecting this (instead of
 * reaching for the module-level function) is what lets the tests script each
 * command and each failure without a running shell.
 */
export type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

/**
 * The three commands the approval card drives, behind one swappable object.
 * Real mode builds it from `invoke`; demo mode builds it from fixtures, so the
 * card code never branches on demo vs real.
 */
export interface ApprovalCommands {
  /** The pending approval to show, or `null` when there is none. */
  current: () => Promise<ApprovalSnapshot | null>;
  /** Shows the real Touch ID prompt and resolves to the authorised snapshot. */
  authorize: (id: string) => Promise<ApprovalSnapshot>;
  deny: (id: string) => Promise<ApprovalSnapshot>;
}

/** `approval_current()` — the snapshot to hydrate the card from. */
export async function approvalCurrent(
  invokeImpl: InvokeFn = invoke,
): Promise<ApprovalSnapshot | null> {
  try {
    return await invokeImpl<ApprovalSnapshot | null>("approval_current");
  } catch (error) {
    throw toApprovalError(error);
  }
}

/** `approval_authorize(id)` — the only gesture that may lead to signing. */
export async function approvalAuthorize(
  id: string,
  invokeImpl: InvokeFn = invoke,
): Promise<ApprovalSnapshot> {
  try {
    return await invokeImpl<ApprovalSnapshot>("approval_authorize", { id });
  } catch (error) {
    throw toApprovalError(error);
  }
}

/** `approval_deny(id)` — the safe, fail-closed choice. */
export async function approvalDeny(
  id: string,
  invokeImpl: InvokeFn = invoke,
): Promise<ApprovalSnapshot> {
  try {
    return await invokeImpl<ApprovalSnapshot>("approval_deny", { id });
  } catch (error) {
    throw toApprovalError(error);
  }
}

/** Binds the real Tauri commands. Demo mode builds its own via `createDemoCommands`. */
export function createApprovalCommands(invokeImpl: InvokeFn = invoke): ApprovalCommands {
  return {
    current: () => approvalCurrent(invokeImpl),
    authorize: (id) => approvalAuthorize(id, invokeImpl),
    deny: (id) => approvalDeny(id, invokeImpl),
  };
}
