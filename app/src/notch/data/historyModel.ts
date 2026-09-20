/**
 * Pure mappers for the History page (NW4): local turns + on-chain payments →
 * one timeline in the exact shape `HistoryPage` already renders.
 *
 * Nothing here touches React, Tauri or the network, so the merge (including the
 * tx-hash de-duplication between a turn and its on-chain echo) is unit-tested
 * under `node:test` (`historyModel.test.ts`).
 */
import type { WalletTransaction } from "../../lib/history.ts";
import type { HistoryEntry, TxStatus } from "../../lib/mockData.ts";
import { truncateKey } from "../../lib/mockData.ts";
import type { TurnLogEntry } from "../../lib/turnLog.ts";

/** The page's view model: the original `HistoryEntry` plus an explorer link. */
export interface HistoryEntryView extends HistoryEntry {
  explorerUrl: string | null;
}

/** Maps a turn's outcome label onto the page's status icon. */
export function turnStatus(outcome: string): TxStatus {
  if (outcome.startsWith("failed") || outcome === "superseded") return "failed";
  if (outcome === "in_progress") return "pending";
  return "success";
}

/** One local turn → one page row. Rows with a tx expand in place. */
export function turnToRow(entry: TurnLogEntry): HistoryEntryView {
  const submitted = entry.txHash !== null;
  return {
    id: `turn:${entry.id}`,
    timestamp: Math.floor(entry.timestampMs / 1000),
    transcript: entry.transcript,
    response: entry.answer.length > 0 ? entry.answer : "…",
    action: submitted ? "Transaction submitted" : null,
    status: turnStatus(entry.outcome),
    txHash: entry.txHash,
    explorerUrl: entry.explorerUrl,
  };
}

/** Turns the log, newest first, into page rows. */
export function turnsToRows(entries: readonly TurnLogEntry[]): HistoryEntryView[] {
  return entries.map(turnToRow);
}

/** One on-chain payment → one page row, expandable to its hash/explorer link. */
export function chainToRow(tx: WalletTransaction): HistoryEntryView {
  const sent = tx.direction === "sent";
  const who = tx.counterpartyAlias ?? truncateKey(tx.counterparty, 6, 4);
  const verb = sent ? "Sent" : "Received";
  const summary = `${verb} ${tx.amount} ${tx.asset}`;
  return {
    id: `chain:${tx.id}`,
    timestamp: Math.floor(tx.createdAtMs / 1000),
    transcript: summary,
    response: sent ? `To ${who}` : `From ${who}`,
    action: `${summary} ${sent ? "to" : "from"} ${who}`,
    status: "success",
    txHash: tx.hash,
    explorerUrl: tx.explorerUrl,
  };
}

/**
 * Merges the two sources, newest first. A turn that submitted a transaction is
 * the richer record of that payment, so the matching chain row is dropped when
 * they share a hash.
 */
export function mergeHistory(
  turns: readonly HistoryEntryView[],
  chain: readonly HistoryEntryView[],
): HistoryEntryView[] {
  const submitted = new Set(
    turns.map((row) => row.txHash).filter((hash): hash is string => hash !== null),
  );
  const deduped = chain.filter((row) => row.txHash === null || !submitted.has(row.txHash));
  return [...turns, ...deduped].sort(
    (a, b) => b.timestamp - a.timestamp || a.id.localeCompare(b.id),
  );
}
