import type { ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { Button } from "@/components/ui/button";

/**
 * Shared chrome for every panel window: a title area, a scrolling body and the
 * dark cockpit palette from `index.css`. Panels only supply their content, so
 * all windows stay visually identical.
 */
export interface PanelShellProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export function PanelShell({ title, subtitle, children }: PanelShellProps) {
  return (
    <div className="flex h-full flex-col bg-polaris-bg text-polaris-text">
      <header className="flex items-start justify-between gap-4 border-b border-polaris-line px-5 py-4">
        <div className="min-w-0">
          <h1 className="text-base font-semibold tracking-tight">{title}</h1>
          {subtitle ? (
            <p className="mt-0.5 text-xs text-polaris-muted">{subtitle}</p>
          ) : null}
        </div>
        {/* Closing hides the window in Rust (`panels::handle_window_event`), so
            the app keeps running and the next open reuses this webview. */}
        <Button
          variant="ghost"
          size="sm"
          aria-label="Close panel"
          onClick={() => {
            void getCurrentWindow()
              .close()
              .catch((error: unknown) => {
                console.warn("panel could not close", error);
              });
          }}
        >
          Close
        </Button>
      </header>
      <div className="polaris-scroll flex-1 overflow-y-auto px-5 py-4">{children}</div>
    </div>
  );
}

/** The consistent "not built yet" callout every panel skeleton uses. */
export function PanelNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-polaris-line bg-polaris-panel/60 px-3 py-2 text-xs leading-5 text-polaris-muted">
      {children}
    </p>
  );
}
