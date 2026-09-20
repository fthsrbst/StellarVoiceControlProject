import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  buildScheduleForm,
  previewFirstRun,
  type RepeatChoice,
  type ScheduleAsset,
  type ScheduleForm,
} from "@/lib/schedules";

const FIELD =
  "w-full rounded-md border border-polaris-line bg-black/20 px-2 py-1 text-sm text-polaris-text outline-none focus:border-polaris-accent";

export interface NewScheduleFormProps {
  disabled: boolean;
  timeZone: string;
  /** Called with the validated form; the panel turns it into a transaction. */
  onCreate: (form: ScheduleForm) => void;
}

/** The "New schedule" form: recipient, amount, first run and optional repeat. */
export function NewScheduleForm({ disabled, timeZone, onCreate }: NewScheduleFormProps) {
  const [form, setForm] = useState<ScheduleForm>({
    recipient: "acc2",
    amount: "",
    asset: "XLM",
    date: "",
    time: "10:00",
    timeZone,
    repeat: "none",
    runs: "",
  });
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(() => {
    if (!form.date || !form.time) return null;
    return previewFirstRun({ localDate: form.date, localTime: form.time, timeZone: form.timeZone });
  }, [form.date, form.time, form.timeZone]);

  const update = (patch: Partial<ScheduleForm>) => setForm((current) => ({ ...current, ...patch }));

  const submit = () => {
    const built = buildScheduleForm(form);
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setError(null);
    onCreate(form);
  };

  return (
    <section className="space-y-3 rounded-lg border border-polaris-line bg-polaris-panel/40 px-3 py-3">
      <h2 className="text-sm font-semibold">New schedule</h2>

      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-1 text-xs text-polaris-muted">
          Recipient
          <input
            className={FIELD}
            value={form.recipient}
            onChange={(event) => update({ recipient: event.target.value })}
            placeholder="acc2"
          />
        </label>
        <label className="col-span-1 text-xs text-polaris-muted">
          Amount
          <input
            className={FIELD}
            value={form.amount}
            onChange={(event) => update({ amount: event.target.value })}
            placeholder="5"
            inputMode="decimal"
          />
        </label>
        <label className="col-span-1 text-xs text-polaris-muted">
          Asset
          <select
            className={FIELD}
            value={form.asset}
            onChange={(event) => update({ asset: event.target.value as ScheduleAsset })}
          >
            <option value="XLM">XLM</option>
            <option value="USDC">USDC</option>
          </select>
        </label>
        <label className="col-span-1 text-xs text-polaris-muted">
          Repeat
          <select
            className={FIELD}
            value={form.repeat}
            onChange={(event) => update({ repeat: event.target.value as RepeatChoice })}
          >
            <option value="none">one-shot</option>
            <option value="day">every day</option>
            <option value="week">every week</option>
          </select>
        </label>
        <label className="col-span-1 text-xs text-polaris-muted">
          First run date
          <input
            type="date"
            className={FIELD}
            value={form.date}
            onChange={(event) => update({ date: event.target.value })}
          />
        </label>
        <label className="col-span-1 text-xs text-polaris-muted">
          First run time
          <input
            type="time"
            className={FIELD}
            value={form.time}
            onChange={(event) => update({ time: event.target.value })}
          />
        </label>
        {form.repeat !== "none" ? (
          <label className="col-span-2 text-xs text-polaris-muted">
            How many runs
            <input
              className={FIELD}
              value={form.runs}
              onChange={(event) => update({ runs: event.target.value })}
              placeholder="8"
              inputMode="numeric"
            />
          </label>
        ) : null}
      </div>

      {preview ? (
        preview.ok ? (
          <p className="text-[11px] text-polaris-muted">
            First run: <span className="selectable text-polaris-text">{preview.localIso}</span> ({form.timeZone}) ·{" "}
            <span className="selectable text-polaris-text">{preview.utcIso}</span> UTC
            {preview.ambiguous ? " · that local time occurs twice; the earlier instant is used" : ""}
          </p>
        ) : (
          <p className="text-[11px] text-polaris-warn">{preview.error}</p>
        )
      ) : null}

      {error ? <p className="text-[11px] text-polaris-danger">{error}</p> : null}

      <div className="flex items-center justify-end gap-2">
        <Button size="sm" onClick={submit} disabled={disabled}>
          {disabled ? "Submitting…" : "Create schedule"}
        </Button>
      </div>
      <p className="text-[10px] text-polaris-muted">
        Creating a schedule is a new commitment: it needs Touch ID, like a payment.
      </p>
    </section>
  );
}
