import { Button } from "@/components/ui/button";
import {
  changeKind,
  effectLine,
  isArmed,
  readBackBaseline,
  readBackDisable,
  readBackEnable,
  readBackTighten,
  validateBaseline,
  validateLimits,
  validateRuleFields,
  type LimitsFields,
  type ProfileMode,
  type SecurityState,
} from "@/lib/guardState.ts";

/** The primary actions the form can request. */
export type SecurityAction = "baseline" | "enable" | "tighten" | "disable";

export interface ProfileFormProps {
  state: SecurityState;
  mode: ProfileMode;
  onModeChange: (mode: ProfileMode) => void;
  fields: LimitsFields;
  onFieldsChange: (fields: LimitsFields) => void;
  executor: string;
  onExecutorChange: (value: string) => void;
  revokeAllowance: boolean;
  onRevokeAllowanceChange: (value: boolean) => void;
  running: boolean;
  onAction: (action: SecurityAction) => void;
}

const INPUT_CLASS =
  "w-full rounded-md border border-polaris-line bg-polaris-panel-alt/60 px-2 py-1.5 font-mono text-xs text-polaris-text outline-none focus-visible:ring-2 focus-visible:ring-polaris-accent/60 disabled:opacity-40";

const LABEL_CLASS = "text-[11px] uppercase tracking-wide text-polaris-muted";

/**
 * The profile + limits form. Pure presentation over `guardState`'s validators:
 * it shows the effect line and the read-back sentence, and only enables an
 * action when the fields validate. It never signs; `onAction` runs the plan.
 */
export function ProfileForm({
  state,
  mode,
  onModeChange,
  fields,
  onFieldsChange,
  executor,
  onExecutorChange,
  revokeAllowance,
  onRevokeAllowanceChange,
  running,
  onAction,
}: ProfileFormProps) {
  const armed = isArmed(state);
  const hasRule = state.rule !== null;
  const enableValidation = validateLimits(fields, {
    executor,
    assetContractId: state.assetContractId,
  });
  const baselineValidation = validateBaseline(fields, state.assetContractId);
  const ruleValidation = validateRuleFields(fields, state.assetContractId);
  const classification = changeKind(state, fields);

  const readBack = !hasRule
    ? readBackBaseline(fields, state.assetSymbol)
    : !armed && enableValidation.draft
      ? readBackEnable(enableValidation.draft, state.assetSymbol)
      : readBackTighten(fields, state.assetSymbol);

  const errors = !hasRule
    ? baselineValidation.errors
    : armed
      ? ruleValidation.errors
      : enableValidation.errors;

  return (
    <section className="space-y-3 rounded-lg border border-polaris-line bg-polaris-panel/60 p-3">
      <header className="space-y-1">
        <h2 className="text-sm font-semibold">Profile & limits</h2>
        <p className="text-xs text-polaris-muted">{effectLine(mode, fields, state.assetSymbol)}</p>
      </header>

      <div className="flex gap-2" role="radiogroup" aria-label="Approval profile">
        {(["always_ask", "auto_under_limit"] as const).map((option) => (
          <Button
            key={option}
            size="sm"
            variant={mode === option ? "secondary" : "outline"}
            role="radio"
            aria-checked={mode === option}
            onClick={() => onModeChange(option)}
          >
            {option === "always_ask" ? "Always ask" : "Auto under limit"}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className={LABEL_CLASS}>Per payment ({state.assetSymbol})</span>
          <input
            className={INPUT_CLASS}
            inputMode="decimal"
            value={fields.perTx}
            onChange={(event) => onFieldsChange({ ...fields, perTx: event.target.value })}
          />
        </label>
        <label className="space-y-1">
          <span className={LABEL_CLASS}>Per day ({state.assetSymbol})</span>
          <input
            className={INPUT_CLASS}
            inputMode="decimal"
            value={fields.daily}
            onChange={(event) => onFieldsChange({ ...fields, daily: event.target.value })}
          />
        </label>
        <label className="space-y-1">
          <span className={LABEL_CLASS}>Auto-approve threshold</span>
          <input
            className={INPUT_CLASS}
            inputMode="decimal"
            value={mode === "always_ask" ? "0" : fields.threshold}
            disabled={mode === "always_ask"}
            onChange={(event) => onFieldsChange({ ...fields, threshold: event.target.value })}
          />
        </label>
        <label className="space-y-1">
          <span className={LABEL_CLASS}>Allowance ({state.assetSymbol})</span>
          <input
            className={INPUT_CLASS}
            inputMode="decimal"
            value={fields.allowance}
            onChange={(event) => onFieldsChange({ ...fields, allowance: event.target.value })}
          />
        </label>
        <label className="space-y-1">
          <span className={LABEL_CLASS}>Allowance days (1–90)</span>
          <input
            className={INPUT_CLASS}
            type="number"
            min={1}
            max={90}
            value={fields.allowanceDays}
            onChange={(event) => onFieldsChange({ ...fields, allowanceDays: Number(event.target.value) })}
          />
        </label>
        <label className="space-y-1">
          <span className={LABEL_CLASS}>Executor (agent key)</span>
          <input
            className={INPUT_CLASS}
            placeholder="G…"
            value={executor}
            onChange={(event) => onExecutorChange(event.target.value)}
          />
        </label>
      </div>

      <div className="flex items-center justify-between gap-2 text-xs">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={fields.knownRecipientsOnly}
            onChange={(event) => onFieldsChange({ ...fields, knownRecipientsOnly: event.target.checked })}
          />
          Saved contacts only
        </label>
        <span className="text-polaris-muted">Asset: {state.assetSymbol} (native, one per rule)</span>
      </div>

      {errors.length > 0 ? (
        <ul className="space-y-0.5 text-xs text-polaris-danger" role="alert">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}

      <div className="space-y-1 rounded-md border border-polaris-line bg-polaris-panel-alt/60 p-2">
        <span className={LABEL_CLASS}>Read-back before signing</span>
        <p className="text-xs leading-5">{readBack}</p>
        {classification === "loosening" || classification === "mixed" ? (
          <p className="text-xs text-polaris-warn">
            This loosens the current rule — it needs the full approval card + Touch ID.
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {!hasRule ? (
          <Button
            size="sm"
            disabled={running || !baselineValidation.ok}
            onClick={() => onAction("baseline")}
          >
            Set up Always-ask baseline
          </Button>
        ) : null}
        {!armed ? (
          <Button
            size="sm"
            disabled={running || !enableValidation.ok}
            onClick={() => onAction("enable")}
          >
            Enable auto-pay
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={running || !ruleValidation.ok}
              onClick={() => onAction("tighten")}
            >
              Apply limits
            </Button>
            <Button size="sm" variant="danger" disabled={running} onClick={() => onAction("disable")}>
              Disable auto-pay
            </Button>
          </>
        )}
      </div>

      {armed ? (
        <label className="flex items-center gap-2 text-xs text-polaris-muted">
          <input
            type="checkbox"
            checked={revokeAllowance}
            onChange={(event) => onRevokeAllowanceChange(event.target.checked)}
          />
          {readBackDisable(revokeAllowance, state.assetSymbol)} (disables ALL guard payments)
        </label>
      ) : null}
    </section>
  );
}
