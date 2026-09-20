import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clearDismissals,
  DISMISSALS_STORAGE_KEY,
  dismissSuggestion,
  readDismissals,
  type StorageLike,
} from "./dismissals.ts";

function fakeStorage(initial?: string): StorageLike & { value: string | null } {
  const store = {
    value: initial ?? null,
    getItem(_key: string) {
      return store.value;
    },
    setItem(_key: string, value: string) {
      store.value = value;
    },
    removeItem(_key: string) {
      store.value = null;
    },
  };
  return store;
}

test("an empty store reads as no dismissals", () => {
  assert.deepEqual(readDismissals(fakeStorage()), []);
  assert.deepEqual(readDismissals(undefined), []);
});

test("a dismissal is added once and survives a reload", () => {
  const storage = fakeStorage();
  assert.deepEqual(dismissSuggestion("auto_pay_threshold", storage), ["auto_pay_threshold"]);
  assert.deepEqual(dismissSuggestion("auto_pay_threshold", storage), ["auto_pay_threshold"]);
  assert.deepEqual(readDismissals(storage), ["auto_pay_threshold"]);
});

test("corrupt or non-array JSON reads as empty, never throws", () => {
  assert.deepEqual(readDismissals(fakeStorage("{not json")), []);
  assert.deepEqual(readDismissals(fakeStorage('{"a":1}')), []);
  assert.deepEqual(readDismissals(fakeStorage('["ok", 3, null]')), ["ok"]);
});

test("a storage that throws never breaks the caller", () => {
  const throwing: StorageLike = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  assert.deepEqual(readDismissals(throwing), []);
  assert.deepEqual(dismissSuggestion("x", throwing), ["x"]);
});

test("clearDismissals empties the store", () => {
  const storage = fakeStorage();
  dismissSuggestion("x", storage);
  clearDismissals(storage);
  assert.deepEqual(readDismissals(storage), []);
});

test("the persistence key is stable", () => {
  assert.equal(DISMISSALS_STORAGE_KEY, "polaris.suggestions.dismissed");
});
