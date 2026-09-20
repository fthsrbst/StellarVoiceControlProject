/**
 * Decodes one decoded-XDR summary line into a label/value pair, or leaves it as
 * plain text.
 *
 * The Rust summary is a list of human strings. Only two shapes get the louder
 * label/value treatment — a destination (`To …`) and the fee (`Fee: …`) —
 * because those are the values a user must read digit-by-digit. Everything else
 * (an operation line, a memo, a future field) is rendered **verbatim**: a line
 * is never dropped or reformatted just because this parser does not know it.
 */

/** A parsed summary row: a known label/value pair, or an untouched string. */
export type SummaryLine =
  | { readonly kind: "pair"; readonly label: "To" | "Fee"; readonly value: string }
  | { readonly kind: "plain"; readonly text: string };

/** `To …` / `To: …` / `Fee …` / `Fee: …`, case-insensitive. */
const PAIR_PATTERN = /^(To|Fee)\b\s*:?(.*)$/i;

/** Parses a single line. Unknown shapes are returned unchanged. */
export function parseSummaryLine(line: string): SummaryLine {
  const match = PAIR_PATTERN.exec(line.trim());
  if (match === null) return { kind: "plain", text: line };
  const value = match[2]!.trim();
  if (value.length === 0) return { kind: "plain", text: line };
  const label = match[1]!.toLowerCase() === "fee" ? "Fee" : "To";
  return { kind: "pair", label, value };
}

/** Parses every line, preserving order and never dropping one. */
export function parseSummaryLines(lines: readonly string[]): SummaryLine[] {
  return lines.map(parseSummaryLine);
}
