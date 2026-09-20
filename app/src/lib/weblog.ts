/**
 * Webview → Rust terminal logging (task F4).
 *
 * `console.*` in the webview never reaches the terminal Polaris is launched
 * from, so a failed payment surfaced only as a generic notch label ("Chain
 * error") with no cause. This wrapper routes a message to the `polaris_log`
 * Rust command, which prints one redacted, truncated line and — when `emit` is
 * set — mirrors it onto the typed `error` event so the Debug panel's tail shows
 * it too.
 *
 * It never throws and no-ops with a console fallback outside a Tauri runtime,
 * so it is safe to call from any failure path: logging must never change the
 * outcome of a turn.
 */
import { invoke, isTauri } from "@tauri-apps/api/core";

/** The severity written into the terminal line (`web[<level>]`). */
export type WebLogLevel = "debug" | "info" | "warn" | "error";

const CONSOLE: Record<WebLogLevel, (message: string) => void> = {
  debug: (message) => console.debug(message),
  info: (message) => console.info(message),
  warn: (message) => console.warn(message),
  error: (message) => console.error(message),
};

/**
 * Logs one webview line to the Rust terminal. `emit` also pushes the same
 * redacted, truncated text as an `error` event, which is what the Debug panel's
 * event tail renders.
 */
export function webLog(level: WebLogLevel, message: string, emit = false): void {
  try {
    if (!isTauri()) {
      CONSOLE[level](`polaris: web[${level}] ${message}`);
      return;
    }
    void invoke("polaris_log", { level, message, emit }).catch(() => {
      // A failed log command is not worth a second failure path.
    });
  } catch {
    // Logging must never take down a turn.
  }
}
