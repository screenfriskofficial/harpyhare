import { useTranslation } from "react-i18next";
import Markdown from "react-markdown";
import { markdownComponents, REMARK_PLUGINS } from "@/components/markdown-config";
import { Button } from "@/components/ui/button";
import type { UpdaterApi } from "@/hooks/useUpdater";
import { t } from "@/i18n";
import type { UpdateProgress } from "@/ipc/types";
import { BRAND_NAME } from "@/lib/brand";
import { SettingBlock, SettingGroup, SettingRow } from "../fields";
import { ScreenShell } from "../ScreenShell";

export type CheckState = "idle" | "checking" | "latest" | { failure: string };

const MIB = 1024 * 1024;
const PERCENT_MAX = 100;

function downloadPercent(progress: UpdateProgress | null): number | null {
  if (progress && progress.total !== null && progress.total > 0) {
    return Math.min(PERCENT_MAX, Math.round((progress.downloaded / progress.total) * PERCENT_MAX));
  }
  return null;
}

function formatMib(bytes: number): string {
  return (bytes / MIB).toFixed(1);
}

function progressCaption(updater: UpdaterApi, percent: number | null): string {
  if (updater.status === "restarting") return t("updates.restarting");
  if (percent !== null) return t("updates.downloadingPercent", { percent });
  return t("updates.downloadingMib", {
    mib: t("units.mib", { value: formatMib(updater.progress?.downloaded ?? 0) }),
  });
}

function checkCaption(state: CheckState): string {
  if (state === "checking") return t("launcher.updates.checking");
  if (state === "latest") return t("launcher.updates.latest");
  if (typeof state === "object") return t("launcher.updates.checkFailed", { error: state.failure });
  return t("launcher.updates.autoCheck");
}

function DownloadProgress({ updater }: { updater: UpdaterApi }) {
  useTranslation();
  const percent = downloadPercent(updater.progress);
  return (
    <div className="grid gap-1.5">
      <div className="h-1 overflow-hidden rounded-full bg-surface-active">
        <div
          className={
            percent === null
              ? "h-full w-full animate-pulse rounded-full bg-primary/60"
              : "h-full rounded-full bg-primary transition-[width]"
          }
          style={percent === null ? undefined : { width: `${String(percent)}%` }}
        />
      </div>
      <span className="font-mono text-caption text-muted-foreground tabular-nums">
        {progressCaption(updater, percent)}
      </span>
    </div>
  );
}

export function UpdatesScreen({
  updater,
  checkState,
  onCheck,
}: {
  updater: UpdaterApi;
  checkState: CheckState;
  onCheck: () => void;
}) {
  const { t } = useTranslation();
  const busy = updater.status === "downloading" || updater.status === "restarting";
  const available = updater.info !== null && !busy;

  return (
    <ScreenShell screen="updates">
      <SettingGroup
        title={t("launcher.updates.version")}
        description={t("launcher.updates.versionDescription", { brand: BRAND_NAME })}
      >
        <SettingRow
          label={`${BRAND_NAME} ${updater.currentVersion}`}
          hint={checkCaption(checkState)}
        >
          <Button variant="ghost" size="sm" disabled={checkState === "checking"} onClick={onCheck}>
            {t("launcher.updates.check")}
          </Button>
        </SettingRow>
      </SettingGroup>

      {updater.info !== null && (
        <SettingGroup
          title={t("updates.available", { version: updater.info.version })}
          description={t("launcher.updates.availableDescription")}
        >
          {updater.info.notes !== "" && (
            <SettingBlock label={t("launcher.updates.whatsNew")}>
              <div className="prose-answer max-h-56 overflow-y-auto rounded-lg bg-surface px-3 py-2 text-body leading-relaxed text-muted-foreground ring-1 ring-border ring-inset">
                <Markdown remarkPlugins={REMARK_PLUGINS} components={markdownComponents}>
                  {updater.info.notes}
                </Markdown>
              </div>
            </SettingBlock>
          )}

          {busy && (
            <SettingBlock label={t("launcher.updates.installing")}>
              <DownloadProgress updater={updater} />
            </SettingBlock>
          )}

          {updater.status === "error" && updater.error !== null && (
            <SettingBlock label={t("launcher.updates.installError")}>
              <span className="text-body whitespace-pre-wrap text-destructive">
                {updater.error}
              </span>
            </SettingBlock>
          )}

          {available && (
            <div className="flex items-center justify-end gap-2 px-3 py-2">
              <Button variant="ghost" size="sm" onClick={updater.dismiss}>
                {t("common.later")}
              </Button>
              <Button size="sm" onClick={updater.install}>
                {updater.status === "error" ? t("common.retry") : t("updates.install")}
              </Button>
            </div>
          )}
        </SettingGroup>
      )}
    </ScreenShell>
  );
}
