/**
 * Security-panel view model, validators and step planning (W6a).
 *
 * Pure: no Tauri, no network, no clock. It turns the owner's form fields into a
 * validated `AutoPayDraft` (or a `Rule`), produces the human read-back and
 * effect copy, fixes the safe step order (D13) and maps a decoded on-chain
 * `SecurityState` to the lines the panel renders. The live reads and the
 * `@polaris/stellar` builder calls live in `guardStateLive.ts`, so this module
 * stays unit-testable under `node:test`.
 *
 * The chain rule is the last defence: the app preference is always mapped from
 * what the chain enforces (`profileFromChain`), never widened here.
 */
import { StrKey } from "@stellar/stellar-sdk";
import { approval, guard } from "@polaris/stellar";
import type { ChainToolResult, Intent } from "@polaris/interfaces";

/** The two profiles the panel exposes (D10/D10b). */
export type ProfileMode = "always_ask" | "auto_under_limit";

/** The editable limit fields, as decimal strings the owner typed. */
export interface LimitsFields {
  /** `auto_approve_limit`: biggest single unattended payment. */
  threshold: string;
  /** `per_tx_limit`: hard per-payment ceiling on every path. */
  perTx: string;
  /** `daily_limit`: the agent's real mandate per UTC day. */
  daily: string;
  /** SAC allowance granted to the guard. */
  allowance: string;
  /** Allowance lifetime in days (1..90). */
  allowanceDays: number;
  /** When set, the agent may only pay addresses in the owner's alias book. */
  knownRecipientsOnly: boolean;
}

/** Sensible first-run defaults (small testnet numbers, editable). */
export const DEFAULT_LIMITS: LimitsFields = {
  threshold: "5",
  perTx: "5",
  daily: "20",
  allowance: "140",
  allowanceDays: 30,
  knownRecipientsOnly: true,
};

/** Addresses the draft/rule is built against (resolved by the live layer). */
export interface LimitsContext {
  executor: string;
  assetContractId: string;
}

/** One alias the owner wants in the on-chain book. */
export interface AliasInput {
  alias: string;
  address: string;
}

/**
 * One alias row: the on-chain value plus why it may be absent. `error` means the
 * read failed (unknown state); `missing` means the name is genuinely not on chain.
 */
export interface AliasLine {
  alias: string;
  onChain: string | null;
  status: "ok" | "missing" | "error";
}

/** A decoded on-chain state plus the addresses it was read with. */
export interface SecurityState {
  owner: string;
  guardContractId: string;
  rpcUrl: string;
  networkPassphrase: string;
  /** Display code of the single allowed asset ("XLM"). */
  assetSymbol: string;
  /** SAC contract id the allowance is granted on. */
  assetContractId: string;
  rule: guard.Rule | null;
  executor: string | null;
  spentTodayRaw: bigint;
  allowanceRaw: bigint | null;
  aliases: AliasLine[];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Draft validation result for the enable flow. */
export interface DraftValidation {
  ok: boolean;
  errors: string[];
  draft: approval.AutoPayDraft | null;
}

/**
 * Validate the enable-auto-pay fields. Reuses the contract-mirroring checks in
 * `validateAutoPayDraft` (amount order, one asset, allowance ≥ daily limit), so
 * a bad field is reported before any XDR is built.
 */
export function validateLimits(fields: LimitsFields, ctx: LimitsContext): DraftValidation {
  try {
    const draft = approval.makeAutoPayDraft({
      executor: ctx.executor,
      threshold: fields.threshold,
      perTxLimit: fields.perTx,
      dailyLimit: fields.daily,
      allowedAssets: [ctx.assetContractId],
      knownRecipientsOnly: fields.knownRecipientsOnly,
      allowance: fields.allowance,
      allowanceDays: fields.allowanceDays,
    });
    approval.validateAutoPayDraft(draft);
    return { ok: true, errors: [], draft };
  } catch (error) {
    return { ok: false, errors: [messageOf(error)], draft: null };
  }
}

/** The `Rule` the fields describe (amounts converted to raw units). */
export function ruleFromFields(fields: LimitsFields, assetContractId: string): guard.Rule {
  return {
    auto_approve_limit: guard.toRawUnits(fields.threshold),
    per_tx_limit: guard.toRawUnits(fields.perTx),
    daily_limit: guard.toRawUnits(fields.daily),
    allowed_assets: [assetContractId],
    known_recipients_only: fields.knownRecipientsOnly,
  };
}

/**
 * Validate the rule part only (used by the tighten and baseline flows, which do
 * not need an executor). The allowance passed is the daily limit, the smallest
 * the contract accepts, because this call only checks the rule shape.
 */
export function validateRuleFields(
  fields: LimitsFields,
  assetContractId: string,
): { ok: boolean; errors: string[]; rule: guard.Rule | null } {
  try {
    const rule = ruleFromFields(fields, assetContractId);
    approval.validateRuleAndAllowance(rule, rule.daily_limit, fields.allowanceDays);
    return { ok: true, errors: [], rule };
  } catch (error) {
    return { ok: false, errors: [messageOf(error)], rule: null };
  }
}

/** The baseline rule (Always ask): threshold 0, no executor is ever set. */
export function baselineRule(fields: LimitsFields, assetContractId: string): guard.Rule {
  return {
    auto_approve_limit: 0n,
    per_tx_limit: guard.toRawUnits(fields.perTx),
    daily_limit: guard.toRawUnits(fields.daily),
    allowed_assets: [assetContractId],
    known_recipients_only: fields.knownRecipientsOnly,
  };
}

/** Validate the Always-ask baseline fields (allowance + a zero-threshold rule). */
export function validateBaseline(
  fields: LimitsFields,
  assetContractId: string,
): { ok: boolean; errors: string[]; rule: guard.Rule | null; allowanceRaw: bigint | null } {
  try {
    const rule = baselineRule(fields, assetContractId);
    const allowanceRaw = guard.toRawUnits(fields.allowance);
    approval.validateBaselineSetup({
      rule,
      allowanceRaw,
      allowanceDays: fields.allowanceDays,
      assetContractId,
    });
    return { ok: true, errors: [], rule, allowanceRaw };
  } catch (error) {
    return { ok: false, errors: [messageOf(error)], rule: null, allowanceRaw: null };
  }
}

/** The app profile the chain currently enforces (never widened). */
export function profileModeOf(state: Pick<SecurityState, "rule" | "executor">): ProfileMode {
  return approval.profileFromChain(state.rule, state.executor).mode === "auto_under_limit"
    ? "auto_under_limit"
    : "always_ask";
}

/** Whether the account is armed for unattended payments (executor + threshold > 0). */
export function isArmed(state: Pick<SecurityState, "rule" | "executor">): boolean {
  return profileModeOf(state) === "auto_under_limit";
}

/** A primary action the profile form can request. */
export type SecurityAction = "baseline" | "enable" | "tighten" | "disable";

/**
 * The fields an action is actually built from: "Always ask" forces the threshold
 * to 0, so switching back from a typed limit can never arm it. Only
 * "Auto under limit" keeps the owner's threshold.
 */
export function effectiveFields(mode: ProfileMode, fields: LimitsFields): LimitsFields {
  return mode === "always_ask" ? { ...fields, threshold: "0" } : fields;
}

/**
 * The action the selected profile requests: "Always ask" builds the Always-ask
 * baseline (threshold 0, no executor); "Auto under limit" arms the typed
 * threshold (or tightens it when already armed).
 */
export function actionForMode(mode: ProfileMode, armed: boolean): SecurityAction {
  if (mode === "always_ask") return "baseline";
  return armed ? "tighten" : "enable";
}

/** Raw units -> decimal string; the panel's single amount formatter. */
export function formatAmount(raw: bigint): string {
  return guard.fromRawUnits(raw);
}

/** One line of plain-language state for the panel's state card. */
export interface StateLine {
  label: string;
  value: string;
}
/** Human lines for the decoded on-chain state. */
export function stateLines(state: SecurityState): StateLine[] {
  const lines: StateLine[] = [
    {
      label: "Profile",
      value: profileModeOf(state) === "always_ask" ? "Always ask" : "Auto under limit",
    },
    {
      label: "Executor",
      value: state.executor ? guard.shortKey(state.executor) : "not registered",
    },
  ];
  if (state.rule) {
    lines.push(
      {
        label: "Auto-approve",
        value: `${guard.fromRawUnits(state.rule.auto_approve_limit)} ${state.assetSymbol}`,
      },
      {
        label: "Per payment",
        value: `${guard.fromRawUnits(state.rule.per_tx_limit)} ${state.assetSymbol}`,
      },
      { label: "Per day", value: `${guard.fromRawUnits(state.rule.daily_limit)} ${state.assetSymbol}` },
      {
        label: "Recipients",
        value: state.rule.known_recipients_only ? "saved contacts only" : "anyone",
      },
    );
  } else {
    lines.push({ label: "Rule", value: "not published" });
  }
  lines.push(
    {
      label: "Allowance",
      value:
        state.allowanceRaw === null
          ? "unknown"
          : `${guard.fromRawUnits(state.allowanceRaw)} ${state.assetSymbol}`,
    },
    {
      label: "Spent today",
      value: `${guard.fromRawUnits(state.spentTodayRaw)} ${state.assetSymbol}`,
    },
  );
  return lines;
}

/** One line per profile: what changes for the owner (D10). */
export function effectLine(mode: ProfileMode, fields: LimitsFields, symbol: string): string {
  if (mode === "always_ask") {
    return "Every payment needs your approval (Touch ID); nothing is auto-approved.";
  }
  return (
    `Payments up to ${fields.threshold} ${symbol}/tx and ${fields.daily} ${symbol}/day are ` +
    "sent without asking; anything above needs Touch ID."
  );
}

/** Read-back sentence for enabling auto-pay (D10c). */
export function readBackEnable(draft: approval.AutoPayDraft, symbol: string): string {
  return approval.readBack(draft, { assetSymbol: symbol });
}

/** Read-back sentence for the Always-ask baseline setup. */
export function readBackBaseline(fields: LimitsFields, symbol: string): string {
  return (
    `Set up the Always-ask baseline: approve ${fields.allowance} ${symbol} to the guard for ` +
    `${fields.allowanceDays} days, per payment ${fields.perTx} ${symbol}, per day ${fields.daily} ` +
    `${symbol}. Every payment still needs your approval.`
  );
}

/** Read-back sentence for tightening/changing the rule. */
export function readBackTighten(fields: LimitsFields, symbol: string): string {
  return (
    `Change the spending rule to auto-approve up to ${fields.threshold} ${symbol}, per payment ` +
    `${fields.perTx} ${symbol}, per day ${fields.daily} ${symbol}, ` +
    `${fields.knownRecipientsOnly ? "saved contacts only" : "anyone"}.`
  );
}

/** Read-back sentence for disabling auto-pay. */
export function readBackDisable(revokeAllowance: boolean, symbol: string): string {
  return approval.readBackDisable({ assetSymbol: symbol, revokeAllowance });
}

/** How the pending rule change compares with the chain (tighten vs loosen). */
export function changeKind(
  state: Pick<SecurityState, "rule" | "assetContractId">,
  fields: LimitsFields,
): approval.ChangeKind | null {
  if (!state.rule) return null;
  try {
    return approval.classifyChange(state.rule, ruleFromFields(fields, state.assetContractId));
  } catch {
    return null;
  }
}

/** Parse the alias editor's `alias = G...` lines into validated entries. */
export function parseAliasEditor(text: string): { entries: AliasInput[]; errors: string[] } {
  const entries: AliasInput[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const match = /^([a-z][a-z0-9_-]{0,31})\s*[=:\s]\s*(\S+)$/.exec(line);
    if (!match) {
      errors.push(`"${line}" is not "alias = G…"`);
      continue;
    }
    const alias = match[1]!;
    const address = match[2]!;
    if (seen.has(alias)) {
      errors.push(`"${alias}" is listed twice`);
      continue;
    }
    if (!StrKey.isValidEd25519PublicKey(address)) {
      errors.push(`"${address}" is not a valid G… address`);
      continue;
    }
    seen.add(alias);
    entries.push({ alias, address });
  }
  return { entries, errors };
}

/**
 * The alias book the panel shows: the union of names read from chain/config and
 * names just saved through the panel, so a fresh save is never dropped while the
 * next read is in flight.
 */
export function mergeAliasLines(
  loaded: readonly AliasLine[],
  saved: Readonly<Record<string, string>>,
): AliasLine[] {
  const byAlias = new Map<string, AliasLine>();
  for (const line of loaded) byAlias.set(line.alias, line);
  for (const [alias, address] of Object.entries(saved)) {
    byAlias.set(alias, { alias, onChain: address, status: "ok" });
  }
  return [...byAlias.values()].sort((a, b) => a.alias.localeCompare(b.alias));
}

/** Every step kind the panel can plan. */
export type PlanStepKind = approval.ApprovalStepKind | "set_alias";

/** A step ready for `runTxSequence` (structurally a `TxRunStep`). */
export interface PlanStep {
  result: ChainToolResult;
  intent: Intent;
  label: string;
}

const STEP_LABELS: Record<PlanStepKind, string> = {
  approve: "Approve the guard allowance",
  set_rule: "Publish the spending rule",
  set_executor: "Register the agent key (arms auto-pay)",
  revoke_executor: "Revoke the executor (disarm)",
  set_alias: "Save alias",
};

/** Short label for a step (progress list and approval card title). */
export function stepLabel(kind: PlanStepKind): string {
  return STEP_LABELS[kind];
}

/**
 * The intent recorded with a step's approval request (kind `guard_policy`). The
 * amount is the step's real one: the allowance for `approve`, the typed
 * threshold for `set_rule`, and `0` for the executor/revoke calls.
 */
export function stepIntent(kind: PlanStepKind, fields: LimitsFields, symbol: string): Intent {
  const amount =
    kind === "approve"
      ? fields.allowance
      : kind === "set_rule"
        ? fields.threshold.trim() || "0"
        : "0";
  return {
    kind: "guard_policy",
    asset: symbol,
    amount,
    source: `security panel: ${kind}`,
  };
}

/** Enable order (D13): the executor registration is the last, arming step. */
export const ENABLE_STEP_ORDER: readonly PlanStepKind[] = ["approve", "set_rule", "set_executor"];
/** Baseline order: allowance first, then the zero-threshold rule; no executor. */
export const BASELINE_STEP_ORDER: readonly PlanStepKind[] = ["approve", "set_rule"];

/** Disable order (D13): disarm first, the optional allowance revoke last. */
export function disableStepOrder(revokeAllowance: boolean): PlanStepKind[] {
  return revokeAllowance ? ["revoke_executor", "approve"] : ["revoke_executor"];
}

/** True when the built kinds match the required safe order exactly. */
export function matchesOrder(
  kinds: readonly string[],
  expected: readonly string[],
): boolean {
  return kinds.length === expected.length && kinds.every((kind, index) => kind === expected[index]);
}
