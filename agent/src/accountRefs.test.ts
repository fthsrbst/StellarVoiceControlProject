import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AccountRefLlm,
  buildAccountBook,
  normalizeAccountRefs,
  normalizeRecipient,
  OWNER_ALIAS,
  RECIPIENT_ALIAS,
  shortAddress,
} from "./accountRefs.ts";
import type { AgentLlm, LlmTurn } from "./loop.ts";

const ALIASES = {
  ada: "GARXWVNCJ22U2OR23LAB5Z5RWI2XFIJZA2R3TRPFUKKY65JQZZOEWWCO",
  acc2: "GB3HO3WGM273M2OZLE5DVRN5WNCNSART6H6SAHP4CXGK34MMGNNDYLX5",
};

test("owner and demo-recipient phrases normalise to acc1 / acc2", () => {
  const cases: Array<[string, string]> = [
    ["wallet 1'den wallet 2'ye 10 XLM gönder", "acc1'den acc2'ye 10 XLM gönder"],
    ["hesap 2'ye 5 dolar gönder", "acc2'ye 5 dolar gönder"],
    ["cüzdan 1'den gönder", "acc1'den gönder"],
    ["account 2 please", "acc2 please"],
    ["birinci hesap", "acc1"],
    ["ikinci hesap", "acc2"],
    ["iki numaralı hesap", "acc2"],
    ["2 numaralı hesap", "acc2"],
    ["benim hesabım", "acc1"],
    ["my wallet", "acc1"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(normalizeAccountRefs(input, ALIASES), expected, input);
  }
});

test("STT-garbled variants map to acc2", () => {
  for (const input of ["AC2", "a c c 2", "O 2", "acc2"]) {
    assert.equal(normalizeAccountRefs(input, ALIASES), "acc2", input);
  }
  assert.equal(normalizeAccountRefs("ek 2'ye gönder", ALIASES), "acc2'ye gönder");
});

test("normalisation is idempotent and leaves unrelated text alone", () => {
  assert.equal(normalizeAccountRefs("acc1'den acc2'ye", ALIASES), "acc1'den acc2'ye");
  assert.equal(normalizeAccountRefs("bugün hava nasıl?", ALIASES), "bugün hava nasıl?");
  assert.equal(normalizeAccountRefs("", ALIASES), "");
});

test("known aliases are canonicalised in case", () => {
  assert.equal(normalizeAccountRefs("ADA'ya 5 XLM gönder", ALIASES), "ada'ya 5 XLM gönder");
});

test("recipient validation accepts every spelling that normalises to an alias", () => {
  for (const value of ["acc2", "wallet 2", "hesap 2'ye", "AC2", "a c c 2", "ek 2", "O 2"]) {
    assert.equal(normalizeRecipient(value, ALIASES), RECIPIENT_ALIAS, value);
  }
  for (const value of ["acc1", "wallet 1", "benim hesabım", "birinci hesap"]) {
    assert.equal(normalizeRecipient(value, ALIASES), OWNER_ALIAS, value);
  }
  assert.equal(normalizeRecipient("ada", ALIASES), "ada");
  assert.equal(normalizeRecipient("wallet 9", ALIASES), undefined);
  assert.equal(normalizeRecipient("Ahmet", ALIASES), undefined);
});

test("buildAccountBook always carries acc1 and acc2, with short addresses", () => {
  const book = buildAccountBook(ALIASES.acc2, ALIASES);
  assert.equal(book.acc1?.address, shortAddress(ALIASES.acc2));
  assert.ok(book.acc1?.address?.startsWith("GB3H"));
  assert.ok(book.acc2);
  assert.ok(book.ada);
  const labelOnly = buildAccountBook(null, {});
  assert.ok(labelOnly.acc1);
  assert.equal(labelOnly.acc1?.address, undefined);
  assert.ok(labelOnly.acc2);
});

test("shortAddress truncates but never guesses", () => {
  assert.equal(shortAddress("GABCDEFGHIJKLMNOP"), "GABC…MNOP");
  assert.equal(shortAddress("GABC"), "GABC");
  assert.equal(shortAddress("   "), undefined);
  assert.equal(shortAddress(undefined), undefined);
});

test("AccountRefLlm normalises the transcript before the model call", async () => {
  let seen = "";
  const inner: AgentLlm = {
    model: "spy",
    async turn(input): Promise<LlmTurn> {
      seen = input.transcript;
      return { toolCalls: [] };
    },
  };
  await new AccountRefLlm(inner, ALIASES).turn({
    transcript: "wallet 1'den wallet 2'ye 10 XLM gönder",
    system: "system",
    tools: [],
  });
  assert.equal(seen, "acc1'den acc2'ye 10 XLM gönder");
});
