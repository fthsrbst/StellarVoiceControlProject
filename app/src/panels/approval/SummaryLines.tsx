import { parseSummaryLines } from "./summaryLines.ts";

/**
 * Renders the decoded summary. Known pairs (`To`, `Fee`) get monospace values so
 * a wrong digit or address stands out; every other line is shown verbatim.
 */
export function SummaryLines({ lines }: { lines: readonly string[] }) {
  return (
    <dl className="space-y-1.5 text-sm">
      {parseSummaryLines(lines).map((line, index) =>
        line.kind === "pair" ? (
          <div key={index} className="flex gap-3">
            <dt className="w-10 shrink-0 text-polaris-muted">{line.label}</dt>
            <dd className="selectable break-all font-mono text-polaris-text">{line.value}</dd>
          </div>
        ) : (
          <div key={index} className="selectable text-polaris-muted">
            {line.text}
          </div>
        ),
      )}
    </dl>
  );
}
