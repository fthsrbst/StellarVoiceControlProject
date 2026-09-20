import { useState } from "react";

import { Button } from "@/components/ui/button";
import { parseAliasEditor, type AliasInput } from "@/lib/guardState.ts";

export interface AliasEditorProps {
  aliases: { alias: string; onChain: string | null }[];
  running: boolean;
  onSave: (entries: AliasInput[]) => void;
}

const INPUT_CLASS =
  "h-20 w-full rounded-md border border-polaris-line bg-polaris-panel-alt/60 px-2 py-1.5 font-mono text-xs text-polaris-text outline-none focus-visible:ring-2 focus-visible:ring-polaris-accent/60";

/** Shorten a `G…` address for display. */
function short(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/**
 * Alias-book editor: one `alias = G…` line per entry, saved with `set_alias`.
 * The parse/validation is pure (`parseAliasEditor`); this file only renders it.
 */
export function AliasEditor({ aliases, running, onSave }: AliasEditorProps) {
  const [text, setText] = useState("");
  const parsed = parseAliasEditor(text);

  return (
    <section className="space-y-3 rounded-lg border border-polaris-line bg-polaris-panel/60 p-3">
      <header className="space-y-1">
        <h2 className="text-sm font-semibold">Alias book</h2>
        <p className="text-xs text-polaris-muted">
          Saved contacts only: the agent may pay these aliases without asking.
        </p>
      </header>

      <ul className="space-y-1 text-xs">
        {aliases.map((entry) => (
          <li key={entry.alias} className="flex justify-between gap-3">
            <span>{entry.alias}</span>
            <span className="selectable font-mono text-polaris-muted">
              {entry.onChain ? short(entry.onChain) : "not on chain"}
            </span>
          </li>
        ))}
        {aliases.length === 0 ? <li className="text-polaris-muted">No aliases configured.</li> : null}
      </ul>

      <label className="block space-y-1">
        <span className="text-[11px] uppercase tracking-wide text-polaris-muted">
          Add or update (one per line: alias = G…)
        </span>
        <textarea
          className={INPUT_CLASS}
          value={text}
          placeholder={"acc2 = G…"}
          onChange={(event) => setText(event.target.value)}
        />
      </label>

      {parsed.errors.length > 0 ? (
        <ul className="space-y-0.5 text-xs text-polaris-danger" role="alert">
          {parsed.errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}

      <Button
        size="sm"
        disabled={running || parsed.entries.length === 0 || parsed.errors.length > 0}
        onClick={() => {
          onSave(parsed.entries);
          setText("");
        }}
      >
        Save {parsed.entries.length > 0 ? `${parsed.entries.length} alias` : "aliases"}
      </Button>
    </section>
  );
}
