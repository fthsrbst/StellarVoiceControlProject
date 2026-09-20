/**
 * The webview's anchor lane (W5b): the injected `Signer` and the session factory.
 *
 * The anchor client in `@polaris/stellar` never holds a key — signing is
 * injected. This module is the one place that connects that seam to the shell's
 * two approved signing paths:
 *
 * * **SEP-10 login challenge** (a transaction with sequence number 0 that can
 *   never be applied on-chain) is signed **wallet-only**, without Touch ID, by
 *   the Rust command `bridge_sign_challenge`. It proves key ownership and moves
 *   no funds.
 * * **Every other anchor transaction** (the USDC trustline `changeTrust`, the
 *   withdrawal payment) goes through the shared approval pipeline
 *   (`@/lib/txPipeline` → Touch ID card → Freighter bridge). The pipeline signs
 *   the exact blob the session built; the session itself submits it, so this
 *   module deliberately does not reach Horizon.
 *
 * The routing decision is read from the XDR alone (`sequence === "0"`), never
 * from caller-supplied text. `bridge_sign_challenge` is feature-detected: on a
 * build without it the login step fails closed with
 * [`AnchorSigningUnavailableError`], which the panel renders as "unknown"
 * rather than a silent skip.
 */
import { invoke } from "@tauri-apps/api/core";
import { Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { anchor, TESTNET } from "@polaris/stellar";
import type { ChainToolResult, Intent } from "@polaris/interfaces";
import type { ExecutionOutcome } from "@polaris/agent";

import { runTx, type TxRunMeta } from "./txPipeline.ts";
import {
  defaultSigningDeps,
  isBridgeSigned,
  signAndSubmit,
  type BridgeOutcome,
  type SigningDeps,
} from "./signing.ts";

/** Thrown when the Rust `bridge_sign_challenge` command is not on this build. */
export class AnchorSigningUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnchorSigningUnavailableError";
  }
}

/**
 * True when a rejected `invoke` means "no such command". Tauri reports a missing
 * command as a string ("Command x not found"), so this is deliberately textual
 * and only used to turn that one case into a clear, feature-detectable error.
 */
export function isMissingCommandError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /not found|unknown command|no such command/i.test(message);
}

/** The facts decoded from one anchor envelope before it is signed. */
export interface AnchorTxFacts {
  /** A sequence-0 SEP-10 challenge: wallet-only, never submitted. */
  isChallenge: boolean;
  /** A best-effort intent for the approval card (decoded from the operations). */
  intent: Intent;
  /** The approval-card summary, decoded from the XDR. */
  summary: ChainToolResult["summary"];
}

/**
 * Classifies an anchor envelope from its XDR. Pure: no signing, no network. The
 * sequence number 0 is the SEP-10 challenge marker (see `sep10.ts`), and it is
 * what routes the signer to the wallet-only path.
 */
export function classifyAnchorTx(
  xdr: string,
  networkPassphrase: string = TESTNET.networkPassphrase,
): AnchorTxFacts {
  const tx = TransactionBuilder.fromXDR(xdr, networkPassphrase);
  if (tx instanceof Transaction && tx.sequence === "0") {
    return {
      isChallenge: true,
      intent: { kind: "raw_tx", asset: "XLM", amount: "0" },
      summary: {
        title: "Anchor login challenge",
        lines: ["Sign in to the anchor by signing a challenge transaction that is never submitted."],
        estimatedFee: "0 XLM",
      },
    };
  }
  const d = anchor.describeXdr(xdr, networkPassphrase);
  const ops = tx instanceof Transaction ? tx.operations : [];
  const trust = ops.some((op) => op.type === "changeTrust");
  const payment = ops.find((op) => op.type === "payment") as
    | { amount?: string; asset?: { code?: string } }
    | undefined;
  const intent: Intent = trust
    ? { kind: "deposit", asset: payment?.asset?.code ?? "USDC", amount: "0" }
    : payment
      ? { kind: "withdraw", asset: payment.asset?.code ?? "USDC", amount: payment.amount ?? "0" }
      : { kind: "raw_tx", asset: "XLM", amount: "0" };
  const title = trust
    ? "Approve the anchor trustline"
    : payment
      ? "Approve the anchor payment"
      : "Approve the anchor transaction";
  return {
    isChallenge: false,
    intent,
    summary: { title, lines: d.lines, estimatedFee: `${d.feeXlm} XLM` },
  };
}

/** The Stellar transaction hash of a signed envelope (lowercase hex). */
export function anchorTxHash(
  signedXdr: string,
  networkPassphrase: string = TESTNET.networkPassphrase,
): string {
  return Buffer.from(TransactionBuilder.fromXDR(signedXdr, networkPassphrase).hash()).toString("hex");
}

/** The injectable seams of [`createAnchorSigner`]. */
export interface AnchorSignerDeps {
  /** The owner `G...` address (read from `stellar_config`). */
  owner: () => Promise<string>;
  /** Wallet-only challenge signing (`bridge_sign_challenge`). */
  signChallenge: (xdr: string) => Promise<BridgeOutcome>;
  /** Touch ID + Freighter signing of a non-challenge envelope; returns the signed XDR. */
  signViaPipeline: (result: ChainToolResult, meta: TxRunMeta) => Promise<string>;
}

/** Default owner reader: the non-secret `stellar_config` command. */
async function defaultOwner(): Promise<string> {
  const { getStellarConfig } = await import("./stellarConfig.ts");
  const config = await getStellarConfig();
  if (!config.ownerAddress) {
    throw new Error("POLARIS_OWNER_ADDRESS is not set; the anchor flow needs the owner wallet");
  }
  return config.ownerAddress;
}

/** Default challenge signer: the W5a Rust command, feature-detected. */
async function defaultSignChallenge(xdr: string): Promise<BridgeOutcome> {
  try {
    return await invoke<BridgeOutcome>("bridge_sign_challenge", { xdr });
  } catch (error) {
    if (isMissingCommandError(error)) {
      throw new AnchorSigningUnavailableError(
        "the Rust command bridge_sign_challenge is not present on this build yet; SEP-10 login cannot be signed",
      );
    }
    throw error;
  }
}

/**
 * Signs a non-challenge envelope through the shared pipeline. `runTx` shows the
 * Touch ID card and signs via the Freighter bridge; its submit step is replaced
 * with a pure capture, because an `AnchorSession` owns submission for the
 * transactions it builds (the trustline in `preflight`, the payment in
 * `payWithdrawal`) and a second Horizon call here would double-submit.
 */
async function defaultSignViaPipeline(result: ChainToolResult, meta: TxRunMeta): Promise<string> {
  let signed: string | undefined;
  const capture: SigningDeps = {
    ...defaultSigningDeps,
    submit: async (signedXdr: string) => ({
      hash: anchorTxHash(signedXdr),
      // No network call and no `tx_submitted` emit: the session will submit.
      explorerUrl: "",
    }),
    emitSubmitted: () => {},
  };
  const sign = (outcome: ExecutionOutcome) => signAndSubmit(outcome, capture);
  const run = await runTx(result, meta, { sign });
  if (run.status !== "submitted" || !signed) {
    const detail = run.status === "submitted" ? "no signed envelope was produced" : run.detail;
    throw new Error(detail || "the anchor transaction was not approved");
  }
  return signed;
}

/**
 * Builds the injected `Signer`. The `signTransaction` routing is the product
 * signing policy: sequence 0 is the wallet-only login challenge, everything else
 * is the Touch ID + Freighter pipeline.
 */
export function createAnchorSigner(overrides: Partial<AnchorSignerDeps> = {}): anchor.Signer {
  const owner = overrides.owner ?? defaultOwner;
  const signChallenge = overrides.signChallenge ?? defaultSignChallenge;
  const signViaPipeline = overrides.signViaPipeline ?? defaultSignViaPipeline;
  return {
    publicKey: () => owner(),
    async signTransaction(xdr, opts) {
      const passphrase = opts?.networkPassphrase ?? TESTNET.networkPassphrase;
      const facts = classifyAnchorTx(xdr, passphrase);
      if (facts.isChallenge) {
        const outcome = await signChallenge(xdr);
        if (!isBridgeSigned(outcome)) {
          throw new Error(`the wallet did not sign the anchor login challenge: ${outcome.message}`);
        }
        return outcome.signedXdr;
      }
      return signViaPipeline({ unsignedXdr: xdr, summary: facts.summary }, {
        intent: facts.intent,
        label: facts.summary.title,
      });
    },
  };
}

/**
 * Creates an `AnchorSession` wired to the shell signer (or an injected one).
 * Callers may share an `ExplainLog` so the panel and the TTS narrator see the
 * same records.
 */
export function createAnchorSession(
  options: Partial<anchor.AnchorSessionConfig> = {},
): anchor.AnchorSession {
  return new anchor.AnchorSession({
    ...options,
    signer: options.signer ?? createAnchorSigner(),
  });
}
