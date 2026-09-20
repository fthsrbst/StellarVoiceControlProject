/**
 * HTTP client for the bridge protocol (W4a).
 *
 * The page and its endpoints share one origin, so `baseUrl` is empty by default
 * and every request is same-origin. `credentials: "omit"` and
 * `referrerPolicy: "no-referrer"` keep the one-time token from riding along on
 * any future third-party request.
 */
import type { BridgePayload, BridgeResult } from "./types.ts";

/** Thrown when an endpoint answers with a non-2xx status. */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export interface BridgeHttp {
  getPayload(token: string): Promise<BridgePayload>;
  postResult(token: string, result: BridgeResult): Promise<void>;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (typeof body.error === "string" && body.error.length > 0) return body.error;
  } catch {
    // Fall through to the generic message when the body is not JSON.
  }
  return `request failed with status ${response.status}`;
}

export function createHttpBridge(baseUrl = ""): BridgeHttp {
  return {
    async getPayload(token: string): Promise<BridgePayload> {
      const response = await fetch(`${baseUrl}/sign/payload?t=${encodeURIComponent(token)}`, {
        headers: { Accept: "application/json" },
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      if (!response.ok) throw new HttpError(response.status, await readError(response));
      return (await response.json()) as BridgePayload;
    },

    async postResult(token: string, result: BridgeResult): Promise<void> {
      const response = await fetch(`${baseUrl}/sign/result?t=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result),
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      if (!response.ok) throw new HttpError(response.status, await readError(response));
    },
  };
}
