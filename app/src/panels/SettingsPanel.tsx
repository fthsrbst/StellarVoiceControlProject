import { useCallback, useEffect, useState } from "react";
import type { AppInfo, PolarisEvent } from "@polaris/interfaces";

import { getAppInfo } from "@/lib/polaris";
import { usePolarisEvents } from "@/panels/events";
import { PanelNote, PanelShell } from "@/panels/PanelShell";

/**
 * Settings panel skeleton.
 *
 * Shows build/network metadata read through `@/lib/polaris` and the latest error
 * the shell reported, so it doubles as a small diagnostics surface. The real
 * preferences and security profiles arrive in milestone W2.
 */
export function SettingsPanel() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const onEvent = useCallback((event: PolarisEvent) => {
    if (event.type === "error") setLastError(event.message);
  }, []);
  usePolarisEvents(onEvent);

  useEffect(() => {
    let cancelled = false;
    getAppInfo()
      .then((next) => {
        if (!cancelled) setInfo(next);
      })
      .catch((error: unknown) => {
        if (!cancelled) console.warn("settings could not read app_info", error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <PanelShell title="Settings" subtitle="Preferences and security">
      <div className="space-y-4">
        <PanelNote>
          Preferences and security profiles land in milestone W2. This shell only
          reads app metadata and the error stream — it never handles a secret.
        </PanelNote>
        <dl className="space-y-2 text-xs">
          <div className="flex justify-between gap-4">
            <dt className="text-polaris-muted">Version</dt>
            <dd className="selectable">{info?.version ?? "…"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-polaris-muted">Network</dt>
            <dd className="selectable">{info?.network ?? "…"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-polaris-muted">Tauri</dt>
            <dd className="selectable">{info?.tauriVersion ?? "…"}</dd>
          </div>
        </dl>
        <div className="space-y-1 text-xs">
          <p className="text-polaris-muted">Latest error</p>
          <p className="selectable break-words text-polaris-danger">
            {lastError ?? "None in this session"}
          </p>
        </div>
      </div>
    </PanelShell>
  );
}
