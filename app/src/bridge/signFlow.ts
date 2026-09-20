/**
 * The bridge state machine (W4a).
 *
 * Deliberately pure: the wallet and the HTTP transport are injected, so the
 * whole flow (including every failure path) is unit-testable without a browser,
 * a wallet extension, or a server. The UI only renders the states this emits.
 */
import { HttpError } from "./http.ts";
import type { BridgeHttp } from "./http.ts";
import type { BridgeErrorCode, BridgePayload, BridgeResult, DebugEntry, SignFlowState } from "./types.ts";
import { verifySignedXdr } from "./verify.ts";
import type { VerifySignedXdrResult } from "./verify.ts";

/** The wallet operations the flow needs; the Wallets Kit adapter implements it. */
export interface BridgeWallet {
  connect(options: { networkPassphrase: string }): Promise<{ address: string }>;
  signTransaction(
    xdr: string,
    options: { networkPassphrase: string; address: string },
  ): Promise<{ signedXdr: string; signerAddress?: string }>;
  /** Optional: lets the flow confirm the wallet is on the payload's network. */
  getNetwork?(): Promise<{ networkPassphrase: string }>;
}

export interface SignFlowOptions {
  token: string;
  http: BridgeHttp;
  wallet: BridgeWallet;
  /** Called on every transition so the UI can re-render. */
  onState?: (state: SignFlowState) => void;
  /** Called for each protocol step when the caller asked for `debug=1`. */
  debug?: (entry: DebugEntry) => void;
  now?: () => number;
  /** Overridable for tests; defaults to the real `verifySignedXdr`. */
  verify?: (input: {
    signedXdr: string;
    unsignedXdr: string;
    networkPassphrase: string;
    address: string;
    payloadHash?: string;
  }) => VerifySignedXdrResult;
  /**
   * Awaited after the payload is fetched and before the wallet is prompted, so
   * the user can read the summary before Freighter opens. Tests omit it.
   */
  beforeConnect?: () => Promise<void>;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

/** Freighter's decline code in `@stellar/freighter-api`, preserved by the kit's `parseError`. */
const FREIGHTER_DECLINED_CODE = -4;

/**
 * Heuristic for "the user said no" across wallet error shapes. The Wallets Kit
 * rejects with a plain `{ code, message, ext }` object (not an `Error`), so the
 * message is read with `messageOf` and a known decline code counts as well.
 */
export function isUserRejection(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "code" in error) {
    if ((error as { code: unknown }).code === FREIGHTER_DECLINED_CODE) return true;
  }
  return /reject|declin|denied|cancel|refus/i.test(messageOf(error));
}

/**
 * Runs the flow to a terminal state and resolves with it. The returned state is
 * the same object handed to `onState` last.
 */
export async function runSignFlow(options: SignFlowOptions): Promise<SignFlowState> {
  const now = options.now ?? (() => Date.now());
  const verify = options.verify ?? verifySignedXdr;
  let state: SignFlowState = { status: "loading" };
  let posted = false;

  const emit = (next: SignFlowState): SignFlowState => {
    state = next;
    options.onState?.(state);
    return state;
  };
  const log = (step: string, detail: string): void => {
    options.debug?.({ step, at: now(), detail });
  };

  // Post the outcome at most once; a failing POST must not abort the flow.
  const post = async (result: BridgeResult): Promise<void> => {
    if (posted) {
      log("post", "skipped: a result was already posted");
      return;
    }
    posted = true;
    try {
      await options.http.postResult(options.token, result);
      log("post", `sent ok=${result.ok}`);
    } catch (error) {
      log("post", `failed: ${messageOf(error)}`);
    }
  };

  emit({ status: "loading" });
  log("payload", "requesting payload");

  let payload: BridgePayload;
  try {
    payload = await options.http.getPayload(options.token);
  } catch (error) {
    if (error instanceof HttpError && error.status === 410) {
      log("payload", "token expired (410)");
      return emit({ status: "expired", error: error.message });
    }
    log("payload", `failed: ${messageOf(error)}`);
    return emit({ status: "error", code: "error", error: messageOf(error) });
  }
  log("payload", `received for ${payload.address} on ${payload.networkPassphrase}`);

  emit({ status: "connecting", payload });
  if (options.beforeConnect) await options.beforeConnect();

  let address: string;
  try {
    ({ address } = await options.wallet.connect({ networkPassphrase: payload.networkPassphrase }));
  } catch (error) {
    const code: BridgeErrorCode = "wallet_unavailable";
    log("connect", `failed: ${messageOf(error)}`);
    await post({ ok: false, code, error: messageOf(error) });
    return emit({ status: "error", payload, code, error: messageOf(error) });
  }
  log("connect", `connected ${address}`);

  if (address !== payload.address) {
    const error = `connected address ${address} does not match the expected ${payload.address}`;
    log("address", "mismatch");
    await post({ ok: false, code: "address_mismatch", error });
    return emit({ status: "error", payload, address, code: "address_mismatch", error });
  }
  log("address", "matches the payload");

  if (options.wallet.getNetwork) {
    try {
      const network = await options.wallet.getNetwork();
      if (network.networkPassphrase !== payload.networkPassphrase) {
        const error = `wallet network ${network.networkPassphrase} does not match ${payload.networkPassphrase}`;
        log("network", "mismatch");
        await post({ ok: false, code: "network_mismatch", error });
        return emit({ status: "error", payload, address, code: "network_mismatch", error });
      }
      log("network", `matches ${payload.networkPassphrase}`);
    } catch (error) {
      // A wallet that cannot report its network is not disqualifying here: the
      // signature verification below still binds the result to the network.
      log("network", `could not be read: ${messageOf(error)}`);
    }
  }

  emit({ status: "awaiting_signature", payload, address });
  log("sign", "requesting signature");

  let signedXdr: string;
  try {
    const signed = await options.wallet.signTransaction(payload.xdr, {
      networkPassphrase: payload.networkPassphrase,
      address,
    });
    signedXdr = signed.signedXdr;
  } catch (error) {
    const code: BridgeErrorCode = isUserRejection(error) ? "rejected" : "error";
    log("sign", `${code}: ${messageOf(error)}`);
    await post({ ok: false, code, error: messageOf(error) });
    return emit({
      status: code === "rejected" ? "rejected" : "error",
      payload,
      address,
      code,
      error: messageOf(error),
    });
  }

  const check = verify({
    signedXdr,
    unsignedXdr: payload.xdr,
    networkPassphrase: payload.networkPassphrase,
    address: payload.address,
    payloadHash: payload.payloadHash,
  });
  if (!check.ok) {
    log("verify", `failed: ${check.reason}`);
    await post({ ok: false, code: "error", error: check.reason });
    return emit({ status: "error", payload, address, code: "error", error: check.reason });
  }
  log("verify", "signature valid");

  await post({ ok: true, signedXdr, signerAddress: payload.address });
  return emit({ status: "signed", payload, address, signedXdr });
}
