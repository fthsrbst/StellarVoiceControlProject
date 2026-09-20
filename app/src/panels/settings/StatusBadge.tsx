import { cn } from "@/lib/utils";
import type { SettingStatus } from "@/panels/settings/settingsModel";

const STATUS_STYLES: Record<SettingStatus, string> = {
  ok: "border-polaris-ok/40 bg-polaris-ok/15 text-polaris-ok",
  warn: "border-polaris-warn/40 bg-polaris-warn/15 text-polaris-warn",
  fail: "border-polaris-danger/40 bg-polaris-danger/15 text-polaris-danger",
  unknown: "border-polaris-line bg-polaris-panel/60 text-polaris-muted",
};

const STATUS_LABELS: Record<SettingStatus, string> = {
  ok: "OK",
  warn: "WARN",
  fail: "FAIL",
  unknown: "UNKNOWN",
};

/**
 * Status badge for one setting row: colour **and** text, so the state never
 * depends on colour alone (WCAG 1.4.1). Mirrors the Debug panel's badge.
 */
export function StatusBadge({ status }: { status: SettingStatus }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        STATUS_STYLES[status],
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
