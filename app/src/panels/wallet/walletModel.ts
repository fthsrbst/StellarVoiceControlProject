/**
 * Pure view model for the Wallet panel (step W6c).
 *
 * All of the panel's decisions live here so they run under `node:test` with no
 * DOM and no Tauri: which of the four states to show (unconfigured / funding /
 * offline / ready), how to shorten an address, and how to label a row's time.
 * The React component only renders what this returns.
 */
import {
  DEFAULT_EXPLORER_BASE,
  explorerAccountUrl,
  friendbotUrl,
  mapWalletTransactions,
  type AccountFetchResult,
  type AliasEntryView,
  type PaymentsFetchResult,
  type WalletBalance,
  type WalletTransaction,
} from "../../lib/history.ts";

export type WalletStatus = "loading" | "unconfigured" | "offline" | "unfunded" | "ready";

export interface WalletView {
  status: WalletStatus;
  /** One short human sentence for the non-ready states. */
  message: string;
  ownerAddress: string | null;
  shortAddress: string | null;
  explorerUrl: string | null;
  friendbotUrl: string | null;
  balances: WalletBalance[];
  transactions: WalletTransaction[];
}

export interface WalletViewInput {
  ownerAddress: string | null;
  /** `null` while the first read is still in flight. */
  account: AccountFetchResult | null;
  payments: PaymentsFetchResult | null;
  aliasEntries?: readonly AliasEntryView[];
  explorerBase?: string;
}

/** `GARXWV…WCO` — the first and last four characters of an address. */
export function shortAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/**
 * Folds the fetched account and payments into one of the panel's states. A
 * missing owner is `unconfigured`; a 404 is `unfunded` (with the Friendbot
 * hint); a network failure is `offline`; otherwise the panel is `ready`.
 */
export function deriveWalletView(input: WalletViewInput): WalletView {
  const explorerBase = input.explorerBase ?? DEFAULT_EXPLORER_BASE;
  const ownerAddress = input.ownerAddress && input.ownerAddress.length > 0 ? input.ownerAddress : null;
  const base: Omit<WalletView, "status" | "message"> = {
    ownerAddress,
    shortAddress: ownerAddress ? shortAddress(ownerAddress) : null,
    explorerUrl: ownerAddress ? explorerAccountUrl(explorerBase, ownerAddress) : null,
    friendbotUrl: null,
    balances: [],
    transactions: [],
  };

  if (!ownerAddress) {
    return {
      ...base,
      status: "unconfigured",
      message: "Set POLARIS_OWNER_ADDRESS to see balances and history.",
    };
  }
  if (input.account === null) {
    return { ...base, status: "loading", message: "Reading balances from Horizon…" };
  }
  if (input.account.status === "offline") {
    return {
      ...base,
      status: "offline",
      message: `Horizon is unreachable: ${input.account.message}.`,
    };
  }
  if (input.account.status === "not_found") {
    return {
      ...base,
      status: "unfunded",
      message: "This account is not funded on testnet yet.",
      friendbotUrl: friendbotUrl(ownerAddress),
    };
  }

  const payments = input.payments?.status === "ok" ? input.payments.payments : [];
  return {
    ...base,
    status: "ready",
    message:
      input.payments?.status === "offline"
        ? "Balances loaded; recent transactions are unavailable."
        : "",
    balances: input.account.balances,
    transactions: mapWalletTransactions(payments, {
      ownerAddress,
      aliasEntries: input.aliasEntries ?? [],
      explorerBase,
    }).slice(0, 10),
  };
}

/** "Sep 20, 14:03" — local time, stable across a fixture with an injected zone. */
export function formatTransactionTime(createdAtMs: number, timeZone?: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(createdAtMs));
}
