import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SPP_CONTRACTS,
  SPP_DEPLOYMENT_LEDGER,
  SPP_PRIVACY,
  SPP_RETENTION_LEDGERS,
  SPP_SPIKE_TXS,
  isContractId,
  loadSppStatus,
  sppContractUrl,
  sppTxUrl,
  summarizeSppStatus,
} from "./spp.ts";

test("every SPP contract id is a well-formed contract StrKey", () => {
  for (const id of Object.values(SPP_CONTRACTS)) {
    assert.equal(isContractId(id), true, id);
    assert.equal(id.length, 56);
  }
});

test("the spike's five transactions are unique 64-hex hashes", () => {
  assert.equal(SPP_SPIKE_TXS.length, 5);
  const hashes = new Set(SPP_SPIKE_TXS.map((tx) => tx.hash));
  assert.equal(hashes.size, 5);
  for (const tx of SPP_SPIKE_TXS) {
    assert.match(tx.hash, /^[0-9a-f]{64}$/);
  }
});

test("explorer links are the testnet ones", () => {
  const hash = "a".repeat(64);
  assert.equal(
    sppTxUrl(hash),
    `https://stellar.expert/explorer/testnet/tx/${hash}`,
  );
  assert.equal(
    sppContractUrl(SPP_CONTRACTS.pool),
    `https://stellar.expert/explorer/testnet/contract/${SPP_CONTRACTS.pool}`,
  );
});

test("isContractId accepts only C… StrKeys", () => {
  assert.equal(isContractId(SPP_CONTRACTS.pool), true);
  assert.equal(isContractId("G" + "A".repeat(55)), false);
  assert.equal(isContractId("Cshort"), false);
  assert.equal(isContractId(""), false);
});

test("an unreachable RPC is a failure, not a throw", () => {
  const summary = summarizeSppStatus({
    latestLedger: null,
    rpcUrl: "https://soroban-testnet.stellar.org",
    deploymentLedger: SPP_DEPLOYMENT_LEDGER,
  });
  assert.equal(summary.status, "fail");
  assert.match(summary.detail, /unreachable/);
});

test("a reachable RPC inside the retention window is ok", () => {
  const summary = summarizeSppStatus({
    latestLedger: SPP_DEPLOYMENT_LEDGER + SPP_RETENTION_LEDGERS - 1,
    rpcUrl: "https://soroban-testnet.stellar.org",
    deploymentLedger: SPP_DEPLOYMENT_LEDGER,
  });
  assert.equal(summary.status, "ok");
  assert.match(summary.detail, /inside the ~7-day retention window/);
});

test("a pruned deployment is still reachable but flags the bootnode", () => {
  const summary = summarizeSppStatus({
    latestLedger: SPP_DEPLOYMENT_LEDGER + SPP_RETENTION_LEDGERS + 1,
    rpcUrl: "https://soroban-testnet.stellar.org",
    deploymentLedger: SPP_DEPLOYMENT_LEDGER,
  });
  assert.equal(summary.status, "ok");
  assert.match(summary.detail, /bootnode/);
});

test("loadSppStatus reads the ledger from an injected transport", async () => {
  const facts = await loadSppStatus({
    fetchJson: async () => ({ result: { sequence: 4_800_000 } }),
  });
  assert.equal(facts.latestLedger, 4_800_000);
  assert.equal(facts.deploymentLedger, SPP_DEPLOYMENT_LEDGER);
});

test("loadSppStatus degrades to null when the transport fails", async () => {
  const facts = await loadSppStatus({
    fetchJson: async () => {
      throw new Error("offline");
    },
  });
  assert.equal(facts.latestLedger, null);
});

test("the explainer names what is public and what is hidden", () => {
  const publicText = SPP_PRIVACY.publicOnChain.join(" ");
  const hiddenText = SPP_PRIVACY.hiddenInPool.join(" ");
  assert.match(publicText, /Deposit and withdrawal amounts/);
  assert.match(hiddenText, /hides the recipient's address and the amount/);
  assert.match(SPP_PRIVACY.caveats.join(" "), /Testnet-only, unaudited/);
});
