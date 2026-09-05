import { useTranslation } from "react-i18next";
import Markdown from "react-markdown";
import { markdownComponents, REMARK_PLUGINS } from "@/components/markdown-config";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { UpdaterStatus } from "@/hooks/useUpdater";
import { t } from "@/i18n";
import type { UpdateInfo, UpdateProgress } from "@/ipc/types";

export interface UpdateDialogProps {
  open: boolean;
  info: UpdateInfo;
  status: UpdaterStatus;
  progress: UpdateProgress | null;
  error: string | null;
  currentVersion: string;
  onClose: () => void;
  onInstall: () => void;
  onSkip: () => void;
}

const MIB = 1024 * 1024;
const PERCENT_MAX = 100;
const DIALOG_WIDTH_PX = 440;

function downloadPercent(progress: UpdateProgress | null): number | null {
  if (progress && progress.total !== null && progress.total > 0) {
    return Math.min(PERCENT_MAX, Math.round((progress.downloaded / progress.total) * PERCENT_MAX));
  }
  return null;
}

function formatMib(bytes: number): string {
  return (bytes / MIB).toFixed(1);
}

function progressCaption(
  status: UpdaterStatus,
  percent: number | null,
  progress: UpdateProgress | null,
): string {
  if (status === "restarting") return t("updates.restarting");
  if (percent !== null) return t("updates.downloadingPercent", { percent });
  return t("updates.downloadingMib", {
    mib: t("units.mib", { value: formatMib(progress?.downloaded ?? 0) }),
  });
}

export function UpdateDialog({
  open,
  info,
  status,
  progress,
  error,
  currentVersion,
  onClose,
  onInstall,
  onSkip,
}: UpdateDialogProps) {
  const { t } = useTranslation();
  const busy = status === "downloading" || status === "restarting";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent panelWidthPx={DIALOG_WIDTH_PX}>
        <DialogHeader>
          <DialogTitle>{t("updates.available", { version: info.version })}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 py-1">
          {currentVersion !== "" && (
            <span className="font-mono text-caption text-muted-foreground">
              {currentVersion} → {info.version}
            </span>
          )}

          {info.notes !== "" && <ReleaseNotes notes={info.notes} />}

          {busy && <DownloadProgress status={status} progress={progress} />}

          {status === "error" && error !== null && (
            <span className="text-body whitespace-pre-wrap text-destructive">{error}</span>
          )}
        </div>

        <DialogFooter className="flex-wrap">
          {!busy && (
            <UpdateActions
              status={status}
              onSkip={onSkip}
              onClose={onClose}
              onInstall={onInstall}
            />
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReleaseNotes({ notes }: { notes: string }) {
  return (
    <div className="prose-answer max-h-48 overflow-y-auto rounded-lg bg-surface px-3 py-2 text-body leading-relaxed text-foreground/90 ring-1 ring-border ring-inset">
      <Markdown remarkPlugins={REMARK_PLUGINS} components={markdownComponents}>
        {notes}
      </Markdown>
    </div>
  );
}

function DownloadProgress({
  status,
  progress,
}: {
  status: UpdaterStatus;
  progress: UpdateProgress | null;
}) {
  // Подписывает на смену языка: сам текст собирает `progressCaption` через общий `t`.
  useTranslation();
  const percent = downloadPercent(progress);
  return (
    <div className="grid gap-1.5">
      <div className="h-1 overflow-hidden rounded-full bg-surface-active">
        <div
          className={
            percent === null
              ? "h-full w-full animate-pulse rounded-full bg-primary/60"
              : "h-full rounded-full bg-primary transition-[width]"
          }
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
      <span className="font-mono text-caption text-muted-foreground tabular-nums">
        {progressCaption(status, percent, progress)}
      </span>
    </div>
  );
}

function UpdateActions({
  status,
  onSkip,
  onClose,
  onInstall,
}: {
  status: UpdaterStatus;
  onSkip: () => void;
  onClose: () => void;
  onInstall: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Button variant="ghost" onClick={onSkip}>
        {t("updates.skipVersion")}
      </Button>
      <Button variant="ghost" onClick={onClose}>
        {t("common.later")}
      </Button>
      <Button onClick={onInstall}>
        {status === "error" ? t("common.retry") : t("updates.install")}
      </Button>
    </>
  );
}
