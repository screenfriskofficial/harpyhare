import { Activity, CheckCircle2, Copy, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDiagnostics } from "@/hooks/useDiagnostics";
import type { DiagnosticRecord } from "@/ipc/bindings";

function RecordCard({ record }: { record: DiagnosticRecord }) {
  const { t, i18n } = useTranslation();
  const timings = [
    [t("diagnostics.capture"), record.captureMs],
    [t("diagnostics.processing"), record.processingMs],
    [t("diagnostics.firstText"), record.firstTextMs],
    [t("diagnostics.total"), record.totalMs],
  ] as const;
  return (
    <details className="rounded-lg border bg-card p-3">
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 text-body marker:text-muted-foreground">
        <span className="font-medium">{t(`diagnostics.kind.${record.kind}`)}</span>
        <span className="min-w-0 flex-1 text-caption break-all text-muted-foreground">
          {record.model || record.provider}
        </span>
        <span className={record.errorCode === null ? "text-primary" : "text-destructive"}>
          {record.errorCode === null
            ? t("diagnostics.success")
            : t(`diagnostics.errors.${record.errorCode}.title`)}
        </span>
        <span className="font-mono text-caption tabular-nums">
          {t("diagnostics.milliseconds", { value: record.totalMs })}
        </span>
      </summary>
      <div className="mt-3 space-y-3 border-t pt-3 text-caption">
        <p className="text-muted-foreground">
          {t(`diagnostics.${record.origin}`)} ·{" "}
          {record.kind !== "capture" &&
            `${t(record.viaRelay ? "diagnostics.viaRelay" : "diagnostics.direct")} · `}
          {record.startedAt !== null &&
            new Date(record.startedAt).toLocaleTimeString(i18n.language)}
        </p>
        {record.errorCode !== null && <p>{t(`diagnostics.errors.${record.errorCode}.action`)}</p>}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {timings
            .filter(([, value]) => value !== null)
            .map(([label, value]) => (
              <div key={label} className="flex flex-wrap justify-between gap-1">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-mono tabular-nums">
                  {t("diagnostics.milliseconds", { value })}
                </dd>
              </div>
            ))}
        </dl>
        {record.requests.map((request, index) => (
          <div
            key={index}
            className="space-y-1 rounded bg-surface p-2 font-mono text-hint break-all"
          >
            <p>
              HTTP {request.status} · {t(`diagnostics.requestKind.${request.kind}`)} ·{" "}
              {t("diagnostics.headers")}:{" "}
              {t("diagnostics.milliseconds", { value: request.elapsedMs })}
            </p>
            {request.requestStartedMs !== null && (
              <p>
                {t("diagnostics.requestPreparation")}:{" "}
                {t("diagnostics.milliseconds", { value: request.requestStartedMs })} ·{" "}
                {t("diagnostics.requestWait")}:{" "}
                {t("diagnostics.milliseconds", {
                  value: Math.max(0, request.elapsedMs - request.requestStartedMs),
                })}
              </p>
            )}
            <p>
              {request.requestId
                ? `Request ID: ${request.requestId}`
                : t("diagnostics.noRequestId")}
            </p>
            {request.edgeId && <p>Edge ID: {request.edgeId}</p>}
            {request.retryAfterSeconds !== null && (
              <p>{t("diagnostics.retryAfter", { seconds: request.retryAfterSeconds })}</p>
            )}
          </div>
        ))}
        <p className="font-mono text-hint break-all text-muted-foreground">ID: {record.id}</p>
      </div>
    </details>
  );
}

export function DiagnosticsPanel() {
  const { t } = useTranslation();
  const diagnostics = useDiagnostics();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => {
            void diagnostics.copy();
          }}
        >
          <Copy className="size-3.5" />
          {t("diagnostics.copy")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void diagnostics.clear();
          }}
          disabled={!diagnostics.data?.records.length}
        >
          <Trash2 className="size-3.5" />
          {t("diagnostics.clear")}
        </Button>
        {diagnostics.data && (
          <span className="ml-auto font-mono text-caption text-muted-foreground">
            v{diagnostics.data.appVersion} · {diagnostics.data.platform}
          </span>
        )}
      </div>
      <p className="text-caption leading-relaxed text-muted-foreground">
        {t("diagnostics.privacy")}
      </p>
      <p className="text-caption leading-relaxed text-muted-foreground">
        {t("diagnostics.timingHint")}
      </p>
      {diagnostics.isLoading && <p role="status">{t("common.loading")}</p>}
      {diagnostics.isError && (
        <div role="alert" className="flex items-center gap-2 text-caption">
          <span>{t("diagnostics.loadFailed")}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void diagnostics.refetch();
            }}
          >
            <RefreshCw className="size-3" />
            {t("common.retry")}
          </Button>
        </div>
      )}
      {diagnostics.data?.records.length === 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-dashed p-5 text-body text-muted-foreground">
          <CheckCircle2 className="size-5 shrink-0" />
          {t("diagnostics.empty")}
        </div>
      )}
      <div className="space-y-2">
        {diagnostics.data?.records.map((record) => (
          <RecordCard key={record.id} record={record} />
        ))}
      </div>
    </div>
  );
}

export function DiagnosticsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent panelWidthPx={620}>
        <DialogHeader>
          <DialogTitle>{t("launcher.screens.diagnostics.label")}</DialogTitle>
          <DialogDescription>{t("launcher.screens.diagnostics.description")}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[65vh] overflow-y-auto pr-1">{open && <DiagnosticsPanel />}</div>
      </DialogContent>
    </Dialog>
  );
}

export function DiagnosticsButton({ triggerClass }: { triggerClass: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={triggerClass}
        title={t("launcher.screens.diagnostics.label")}
        aria-label={t("launcher.screens.diagnostics.label")}
        onClick={() => {
          setOpen(true);
        }}
      >
        <Activity />
      </button>
      <DiagnosticsDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
