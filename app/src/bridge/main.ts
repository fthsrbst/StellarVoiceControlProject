/**
 * Freighter signing bridge page (W4a).
 *
 * Plain DOM on purpose: the page is one card and one button. It reads the
 * one-time token from `?t=`, drives `runSignFlow`, and renders the states. With
 * `&debug=1` it also shows a protocol log (never the token or full XDRs).
 */
import "./bridge.css";

import { createHttpBridge } from "./http.ts";
import { runSignFlow } from "./signFlow.ts";
import type { BridgeHttp } from "./http.ts";
import type { DebugEntry, SignFlowState } from "./types.ts";
import { createFreighterWallet } from "./wallet.ts";

type Attrs = Record<string, string | { href: string } | (() => void)>;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === "string") {
      node.setAttribute(key, value);
    } else if (typeof value === "function") {
      node.addEventListener("click", value);
    } else {
      node.setAttribute("href", value.href);
    }
  }
  for (const child of children) node.append(child);
  return node;
}

const params = new URLSearchParams(window.location.search);
const token = params.get("t") ?? "";
const debug = params.get("debug") === "1";

const root = document.getElementById("root");
if (!root) throw new Error("bridge: #root is missing");

const stage = el("div", { class: "stage" });
const card = el("div", { class: "card" });
root.append(stage);
stage.append(card);

const debugLog: DebugEntry[] = [];
let started = false;
let pendingStart: (() => void) | undefined;
let lastState: SignFlowState = { status: "loading" };

/** Releases the pre-connect gate so the wallet prompt may open. */
function start(): void {
  if (started) return;
  started = true;
  pendingStart?.();
  pendingStart = undefined;
  if (lastState.status === "connecting") render(lastState);
}

/** Awaited by the flow after the payload loads and before connecting. */
function beforeConnect(): Promise<void> {
  if (started) return Promise.resolve();
  return new Promise<void>((resolve) => {
    pendingStart = resolve;
  });
}

function brandHeader(): HTMLElement {
  return el("header", { class: "brand" }, [
    el("span", { class: "brand-mark" }, ["◆"]),
    el("div", {}, [
      el("h1", {}, ["Polaris"]),
      el("p", { class: "brand-sub" }, ["Signing bridge"]),
    ]),
  ]);
}

const STEPS = ["Request", "Wallet", "Approve", "Done"] as const;

function stepIndex(state: SignFlowState): number {
  switch (state.status) {
    case "loading":
      return 0;
    case "connecting":
      return 1;
    case "awaiting_signature":
      return 2;
    case "signed":
      return 3;
    default:
      return 2;
  }
}

function steps(state: SignFlowState): HTMLElement {
  const current = stepIndex(state);
  const failed = state.status === "error" || state.status === "rejected" || state.status === "expired";
  const items = STEPS.map((label, index) => {
    const done = index < current || state.status === "signed";
    const active = index === current && state.status !== "signed";
    const classes = ["step"];
    if (done) classes.push("step-done");
    if (active && !failed) classes.push("step-active");
    if (active && failed) classes.push("step-failed");
    return el("div", { class: classes.join(" ") }, [
      el("span", { class: "step-dot" }, [done ? "✓" : String(index + 1)]),
      el("span", { class: "step-label" }, [label]),
    ]);
  });
  return el("div", { class: "steps" }, items);
}

function summary(state: SignFlowState): HTMLElement | null {
  const payload = state.payload;
  if (!payload) return null;
  const lines = payload.summary.lines.map((line) => el("li", {}, [line]));
  const children: (Node | string)[] = [
    el("h2", { class: "summary-title" }, [payload.summary.title]),
    el("ul", { class: "summary-lines" }, lines),
    el("div", { class: "summary-row" }, [
      el("span", { class: "muted" }, ["Estimated fee"]),
      el("span", {}, [payload.summary.estimatedFee]),
    ]),
    el("div", { class: "summary-row" }, [
      el("span", { class: "muted" }, ["Network"]),
      el("span", {}, [payload.networkPassphrase]),
    ]),
  ];
  const explorerUrl = payload.summary.explorerUrl;
  const safeExplorerUrl = explorerUrl ? safeHttpsUrl(explorerUrl) : null;
  if (safeExplorerUrl) {
    children.push(
      el(
        "a",
        {
          class: "explorer",
          href: { href: safeExplorerUrl },
          rel: "noopener noreferrer",
          target: "_blank",
        },
        ["View the account in the explorer"],
      ),
    );
  }
  return el("section", { class: "summary" }, children);
}

/** Returns the URL only when it is a safe `https:` link; anything else is dropped. */
function safeHttpsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function statusBlock(state: SignFlowState): HTMLElement {
  switch (state.status) {
    case "loading":
      return el("p", { class: "status muted" }, ["Loading the signing request…"]);
    case "connecting":
      if (!started) {
        return el("div", { class: "status" }, [
          el("p", {}, [
            "Review the transaction above. Nothing is signed until you approve it in Freighter.",
          ]),
          el("button", { class: "primary", onclick: () => start() }, ["Sign with Freighter"]),
        ]);
      }
      return el("p", { class: "status muted" }, ["Opening Freighter…"]);
    case "awaiting_signature":
      return el("p", { class: "status" }, [
        "Waiting for you to approve the transaction in Freighter…",
      ]);
    case "signed":
      return el("div", { class: "status ok" }, [
        el("strong", {}, ["Signed ✓"]),
        el("p", {}, ["You can close this tab and return to Polaris."]),
      ]);
    case "rejected":
      return el("div", { class: "status danger" }, [
        el("strong", {}, ["Rejected in your wallet"]),
        el("p", {}, ["No transaction was signed. Return to Polaris to try again."]),
      ]);
    case "expired":
      return el("div", { class: "status danger" }, [
        el("strong", {}, ["This signing request expired"]),
        el("p", {}, [state.error ?? "Start a new request from Polaris."]),
      ]);
    case "error":
      return el("div", { class: "status danger" }, [
        el("strong", {}, [`Could not sign (${state.code ?? "error"})`]),
        el("p", {}, [state.error ?? "An unexpected error occurred."]),
      ]);
  }
}

function debugPanel(): HTMLElement | null {
  if (!debug) return null;
  const rows = debugLog.map((entry) => el("li", {}, [`${entry.step}: ${entry.detail}`]));
  return el("details", { class: "debug", open: "" }, [
    el("summary", {}, ["Protocol log"]),
    el("ul", {}, rows),
  ]);
}

function render(state: SignFlowState): void {
  lastState = state;
  card.replaceChildren(brandHeader(), steps(state));
  const summaryNode = summary(state);
  if (summaryNode) card.append(summaryNode);
  card.append(statusBlock(state));
  const debugNode = debugPanel();
  if (debugNode) card.append(debugNode);
}

function update(state: SignFlowState): void {
  render(state);
  if (debug) window.console.info(`[bridge] ${state.status}`);
}

if (!token) {
  card.append(brandHeader());
  card.append(
    el("div", { class: "status danger" }, [
      el("strong", {}, ["No signing request"]),
      el("p", {}, ["Open this page from Polaris with a signing token."]),
    ]),
  );
} else {
  const http: BridgeHttp = createHttpBridge();
  render({ status: "loading" });
  void runSignFlow({
    token,
    http,
    wallet: createFreighterWallet(),
    beforeConnect,
    onState: update,
    debug: debug
      ? (entry) => {
          debugLog.push(entry);
          render(lastState);
        }
      : undefined,
  }).catch((error) => {
    window.console.error("[bridge] the sign flow crashed", error);
  });
}
