import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  TURN_LOG_KEY,
  TURN_LOG_LIMIT,
  clearTurnLog,
  newTurnId,
  parseTurnLog,
  readTurnLog,
  recordTurnAnswer,
  recordTurnOutcome,
  recordTurnStart,
  serializeTurnLog,
  supersedeInProgress,
  upsertTurn,
  type TurnLogEntry,
} from "./turnLog.ts";

function entry(overrides: Partial<TurnLogEntry> = {}): TurnLogEntry {
  return {
    id: "t1",
    timestampMs: 1_700_000_000_000,
    transcript: "Cüzdanımda ne kadar USDC var?",
    answer: "847.20 USDC",
    outcome: "answered",
    txHash: null,
    explorerUrl: null,
    ...overrides,
  };
}

/** A minimal in-memory `localStorage`, so the record flow is testable in Node. */
class FakeStorage {
  #map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.#map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.#map.set(key, value);
  }
  removeItem(key: string): void {
    this.#map.delete(key);
  }
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

test("parseTurnLog: null, garbage and non-arrays read as empty", () => {
  assert.deepEqual(parseTurnLog(null), []);
  assert.deepEqual(parseTurnLog("not json"), []);
  assert.deepEqual(parseTurnLog('{"a":1}'), []);
});

test("parseTurnLog: whitelists fields and drops an XDR a tampered store added", () => {
  const parsed = parseTurnLog(
    JSON.stringify([{ ...entry(), xdr: "AAAA-signed" }]),
  );
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.id, "t1");
  assert.equal("xdr" in (parsed[0] ?? {}), false);
});

test("parseTurnLog: drops malformed entries and caps at the ring-buffer size", () => {
  const many = Array.from({ length: TURN_LOG_LIMIT + 10 }, (_, index) =>
    entry({ id: `t${index}` }),
  );
  const parsed = parseTurnLog(JSON.stringify([...many, { id: "bad" }]));
  assert.equal(parsed.length, TURN_LOG_LIMIT);
  assert.equal(parsed[0]?.id, "t0");
});

test("serializeTurnLog round-trips the newest entries", () => {
  const entries = [entry({ id: "a" }), entry({ id: "b" })];
  assert.deepEqual(parseTurnLog(serializeTurnLog(entries)), entries);
});

test("upsertTurn replaces by id, newest first, and enforces the cap", () => {
  const full = Array.from({ length: TURN_LOG_LIMIT }, (_, index) =>
    entry({ id: `t${index}` }),
  );
  const replaced = upsertTurn(full, entry({ id: "t0", answer: "updated" }));
  assert.equal(replaced.length, TURN_LOG_LIMIT);
  assert.equal(replaced[0]?.id, "t0");
  assert.equal(replaced[0]?.answer, "updated");
  assert.equal(replaced.filter((item) => item.id === "t0").length, 1);

  const grown = upsertTurn(full, entry({ id: "new" }));
  assert.equal(grown.length, TURN_LOG_LIMIT);
  assert.equal(grown[0]?.id, "new");
  assert.equal(grown.at(-1)?.id, `t${TURN_LOG_LIMIT - 2}`);
});

test("supersedeInProgress marks only running turns", () => {
  const result = supersedeInProgress([
    entry({ id: "running", outcome: "in_progress" }),
    entry({ id: "done", outcome: "answered" }),
  ]);
  assert.equal(result[0]?.outcome, "superseded");
  assert.equal(result[1]?.outcome, "answered");
});

test("newTurnId is unique within a session", () => {
  assert.notEqual(newTurnId(1), newTurnId(1));
});

test("record flow: start → answer → outcome persists and is readable", () => {
  (globalThis as unknown as { localStorage?: FakeStorage }).localStorage = new FakeStorage();
  const id = recordTurnStart("10 USDC gönder", 1_700_000_000_000);
  recordTurnAnswer(id, "Sent 10 USDC.");
  recordTurnOutcome(id, {
    label: "tx_submitted",
    txHash: "a".repeat(64),
    explorerUrl: "https://stellar.expert/explorer/testnet/tx/" + "a".repeat(64),
  });

  const stored = readTurnLog();
  assert.equal(stored.length, 1);
  assert.equal(stored[0]?.outcome, "tx_submitted");
  assert.equal(stored[0]?.answer, "Sent 10 USDC.");
  assert.equal(stored[0]?.txHash, "a".repeat(64));
});

test("recordTurnStart supersedes an older running turn", () => {
  (globalThis as unknown as { localStorage?: FakeStorage }).localStorage = new FakeStorage();
  const first = recordTurnStart("first", 1);
  const second = recordTurnStart("second", 2);
  const stored = readTurnLog();
  assert.equal(stored.length, 2);
  assert.equal(stored.find((item) => item.id === first)?.outcome, "superseded");
  assert.equal(stored.find((item) => item.id === second)?.outcome, "in_progress");
});

test("clearTurnLog empties the store; reading without storage stays empty", () => {
  (globalThis as unknown as { localStorage?: FakeStorage }).localStorage = new FakeStorage();
  recordTurnStart("hello", 1);
  clearTurnLog();
  assert.deepEqual(readTurnLog(), []);
  assert.equal(TURN_LOG_KEY, "polaris.turn-log.v1");
});
