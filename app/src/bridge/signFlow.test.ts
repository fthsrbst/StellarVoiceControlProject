import assert from "node:assert/strict";
import { test } from "node:test";

import { Keypair } from "@stellar/stellar-sdk";

import { HttpError } from "./http.ts";
import type { BridgeHttp } from "./http.ts";
import { makePayloadFixture, signXdr } from "./fixtures.ts";
import { runSignFlow } from "./signFlow.ts";
import type { BridgeWallet } from "./signFlow.ts";
import type { BridgePayload, BridgeResult } from "./types.ts";

class FakeHttp implements BridgeHttp {
  readonly posts: BridgeResult[] = [];
  attempts = 0;
  private payloadOrError: BridgePayload | Error;

  constructor(payloadOrError: BridgePayload | Error) {
    this.payloadOrError = payloadOrError;
  }

  async getPayload(): Promise<BridgePayload> {
    if (this.payloadOrError instanceof Error) throw this.payloadOrError;
    return this.payloadOrError;
  }

  async postResult(_token: string, result: BridgeResult): Promise<void> {
    this.attempts += 1;
    this.posts.push(result);
  }
}

interface FakeWalletInit {
  address: string;
  networkPassphrase?: string;
  connectError?: Error;
  signError?: unknown;
  signedXdr?: string;
}

class FakeWallet implements BridgeWallet {
  address: string;
  networkPassphrase: string | undefined;
  connectError: Error | undefined;
  signError: unknown;
  signedXdr: string | undefined;
  signCalls = 0;

  constructor(init: FakeWalletInit) {
    this.address = init.address;
    this.networkPassphrase = init.networkPassphrase;
    this.connectError = init.connectError;
    this.signError = init.signError;
    this.signedXdr = init.signedXdr;
  }

  async connect(): Promise<{ address: string }> {
    if (this.connectError) throw this.connectError;
    return { address: this.address };
  }

  async signTransaction(): Promise<{ signedXdr: string }> {
    this.signCalls += 1;
    if (this.signError) throw this.signError;
    return { signedXdr: this.signedXdr ?? "" };
  }

  async getNetwork(): Promise<{ networkPassphrase: string }> {
    if (this.networkPassphrase === undefined) throw new Error("network unavailable");
    return { networkPassphrase: this.networkPassphrase };
  }
}

function firstPost(http: FakeHttp): BridgeResult {
  const post = http.posts[0];
  assert.ok(post, "expected a result to have been posted");
  return post;
}

test("a valid signature reaches the signed state and posts it once", async () => {
  const { payload, owner } = makePayloadFixture();
  const signedXdr = signXdr(payload.xdr, owner);
  const http = new FakeHttp(payload);
  const wallet = new FakeWallet({
    address: payload.address,
    networkPassphrase: payload.networkPassphrase,
    signedXdr,
  });

  const states: string[] = [];
  const final = await runSignFlow({
    token: "tok",
    http,
    wallet,
    onState: (state) => states.push(state.status),
  });

  assert.equal(final.status, "signed");
  assert.equal(final.signedXdr, signedXdr);
  assert.deepEqual(states, ["loading", "connecting", "awaiting_signature", "signed"]);
  assert.equal(http.attempts, 1);
  assert.deepEqual(firstPost(http), {
    ok: true,
    signedXdr,
    signerAddress: payload.address,
  });
});

test("a user rejection ends in the rejected state and posts the code", async () => {
  const { payload } = makePayloadFixture();
  const http = new FakeHttp(payload);
  const wallet = new FakeWallet({
    address: payload.address,
    networkPassphrase: payload.networkPassphrase,
    signError: new Error("User declined to sign the transaction"),
  });

  const final = await runSignFlow({ token: "tok", http, wallet });

  assert.equal(final.status, "rejected");
  assert.equal(final.code, "rejected");
  assert.deepEqual(firstPost(http), {
    ok: false,
    code: "rejected",
    error: "User declined to sign the transaction",
  });
});

test("a kit-shaped rejection object is classified as rejected", async () => {
  const { payload } = makePayloadFixture();
  const http = new FakeHttp(payload);
  const wallet = new FakeWallet({
    address: payload.address,
    networkPassphrase: payload.networkPassphrase,
    signError: { code: -4, message: "The user rejected this request.", ext: [] },
  });

  const final = await runSignFlow({ token: "tok", http, wallet });

  assert.equal(final.status, "rejected");
  assert.equal(final.code, "rejected");
  const post = firstPost(http);
  assert.equal(post.ok, false);
  if (!post.ok) assert.equal(post.code, "rejected");
});

test("a kit-shaped error with the decline code alone is rejected", async () => {
  const { payload } = makePayloadFixture();
  const http = new FakeHttp(payload);
  const wallet = new FakeWallet({
    address: payload.address,
    networkPassphrase: payload.networkPassphrase,
    signError: { code: -4, message: "Freighter returned an error" },
  });

  const final = await runSignFlow({ token: "tok", http, wallet });

  assert.equal(final.status, "rejected");
  assert.equal(final.code, "rejected");
});

test("a string rejection is classified as rejected", async () => {
  const { payload } = makePayloadFixture();
  const http = new FakeHttp(payload);
  const wallet = new FakeWallet({
    address: payload.address,
    networkPassphrase: payload.networkPassphrase,
    signError: "User declined to sign",
  });

  const final = await runSignFlow({ token: "tok", http, wallet });

  assert.equal(final.status, "rejected");
  assert.equal(final.code, "rejected");
});

test("a kit-shaped non-rejection error stays a generic error", async () => {
  const { payload } = makePayloadFixture();
  const http = new FakeHttp(payload);
  const wallet = new FakeWallet({
    address: payload.address,
    networkPassphrase: payload.networkPassphrase,
    signError: { code: -1, message: "Freighter encountered an internal error", ext: [] },
  });

  const final = await runSignFlow({ token: "tok", http, wallet });

  assert.equal(final.status, "error");
  assert.equal(final.code, "error");
});

test("an undefined sign error is not treated as a rejection", async () => {
  const { payload } = makePayloadFixture();
  const http = new FakeHttp(payload);
  const wallet: BridgeWallet = {
    connect: async () => ({ address: payload.address }),
    getNetwork: async () => ({ networkPassphrase: payload.networkPassphrase }),
    signTransaction: async () => {
      throw undefined;
    },
  };

  const final = await runSignFlow({ token: "tok", http, wallet });

  assert.equal(final.status, "error");
  assert.equal(final.code, "error");
});

test("a connected address that differs from the payload stops before signing", async () => {
  const { payload } = makePayloadFixture();
  const http = new FakeHttp(payload);
  const wallet = new FakeWallet({
    address: "GDIFFERENTADDRESSFORTESTINGONLY000000000000000000000000000000",
    networkPassphrase: payload.networkPassphrase,
  });

  const final = await runSignFlow({ token: "tok", http, wallet });

  assert.equal(final.status, "error");
  assert.equal(final.code, "address_mismatch");
  assert.equal(wallet.signCalls, 0);
  assert.equal(firstPost(http).ok, false);
});

test("a wallet on another network is refused with network_mismatch", async () => {
  const { payload } = makePayloadFixture();
  const http = new FakeHttp(payload);
  const wallet = new FakeWallet({
    address: payload.address,
    networkPassphrase: "Public Global Stellar Network ; September 2015",
  });

  const final = await runSignFlow({ token: "tok", http, wallet });

  assert.equal(final.status, "error");
  assert.equal(final.code, "network_mismatch");
  assert.equal(wallet.signCalls, 0);
  const post = firstPost(http);
  assert.equal(post.ok, false);
  if (!post.ok) assert.equal(post.code, "network_mismatch");
});

test("a wallet that cannot connect is reported as wallet_unavailable", async () => {
  const { payload } = makePayloadFixture();
  const http = new FakeHttp(payload);
  const wallet = new FakeWallet({
    address: payload.address,
    connectError: new Error("Freighter is not installed"),
  });

  const final = await runSignFlow({ token: "tok", http, wallet });

  assert.equal(final.status, "error");
  assert.equal(final.code, "wallet_unavailable");
  const post = firstPost(http);
  assert.equal(post.ok, false);
  if (!post.ok) assert.equal(post.code, "wallet_unavailable");
});

test("an expired token (410) stops without posting anything", async () => {
  const { payload } = makePayloadFixture();
  const http = new FakeHttp(new HttpError(410, "token expired"));
  const wallet = new FakeWallet({ address: payload.address });

  const final = await runSignFlow({ token: "tok", http, wallet });

  assert.equal(final.status, "expired");
  assert.equal(http.attempts, 0);
});

test("a malformed signed XDR fails verification and posts one error", async () => {
  const { payload } = makePayloadFixture();
  const http = new FakeHttp(payload);
  const wallet = new FakeWallet({
    address: payload.address,
    networkPassphrase: payload.networkPassphrase,
    signedXdr: "definitely-not-an-xdr",
  });

  const final = await runSignFlow({ token: "tok", http, wallet });

  assert.equal(final.status, "error");
  assert.equal(final.code, "error");
  assert.equal(http.attempts, 1);
  const post = firstPost(http);
  assert.equal(post.ok, false);
});

test("a signature from the wrong signer is rejected", async () => {
  const { payload } = makePayloadFixture();
  const http = new FakeHttp(payload);
  const wallet = new FakeWallet({
    address: payload.address,
    networkPassphrase: payload.networkPassphrase,
    signedXdr: signXdr(payload.xdr, Keypair.random()),
  });

  const final = await runSignFlow({ token: "tok", http, wallet });

  assert.equal(final.status, "error");
  assert.equal(final.code, "error");
  assert.equal(http.attempts, 1);
  assert.equal(firstPost(http).ok, false);
});

test("the result is posted at most once even if the POST fails", async () => {
  const { payload, owner } = makePayloadFixture();
  let attempts = 0;
  const http: BridgeHttp = {
    getPayload: async () => payload,
    postResult: async () => {
      attempts += 1;
      throw new Error("network down");
    },
  };
  const wallet = new FakeWallet({
    address: payload.address,
    networkPassphrase: payload.networkPassphrase,
    signedXdr: signXdr(payload.xdr, owner),
  });

  const final = await runSignFlow({ token: "tok", http, wallet });

  assert.equal(final.status, "signed");
  assert.equal(attempts, 1);
});
