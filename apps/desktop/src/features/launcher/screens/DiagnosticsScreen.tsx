import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { DEFAULT_MODEL } from "@/ipc/bindings";
import { clearDiagnostics, getDiagnostics, runPreflight } from "@/ipc/commands";
import type { Settings } from "@/ipc/types";
import { SettingGroup, SettingRow } from "../fields";
import { ScreenShell } from "../ScreenShell";

type DiagnosticRecord = Awaited<ReturnType<typeof getDiagnostics>>["records"][number];
type CheckResult = Awaited<ReturnType<typeof runPreflight>>["checks"][number];

const STATUS_LABEL = { passed: "OK", failed: "Ошибка", skipped: "Пропущено" } as const;

function formatDate(timestamp: number | null): string {
  return timestamp === null ? "время неизвестно" : new Date(timestamp).toLocaleString();
}

function RecordRow({ record }: { record: DiagnosticRecord }) {
  return (
    <div className="grid gap-1 px-3 py-2 text-caption">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <strong className="font-medium text-foreground">{record.kind}</strong>
        <span className="text-muted-foreground">{record.provider || "неизвестный провайдер"}</span>
        {record.model !== "" && <span className="text-muted-foreground">{record.model}</span>}
        <span className="ml-auto font-mono text-muted-foreground tabular-nums">
          {String(record.totalMs)} мс
        </span>
      </div>
      <div className="flex flex-wrap gap-x-3 text-muted-foreground">
        <span>{formatDate(record.startedAt)}</span>
        {record.errorCode !== null && <span className="text-destructive">{record.errorCode}</span>}
        {record.requests.map((request, index) => (
          <span key={`${record.id}-${String(index)}`}>HTTP {String(request.status)}</span>
        ))}
      </div>
    </div>
  );
}

export function DiagnosticsScreen({ settings }: { settings: Settings }) {
  const [records, setRecords] = useState<DiagnosticRecord[]>([]);
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Проверки не отправляют аудио или текст на сервер.");

  const refresh = useCallback(async () => {
    const report = await getDiagnostics();
    setRecords(report.records);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const check = async () => {
    setBusy(true);
    setMessage("Проверяю устройства и доступность API…");
    try {
      const report = await runPreflight(DEFAULT_MODEL);
      setChecks(report.checks);
      await refresh();
      setMessage("Проверка завершена.");
    } catch (error) {
      setMessage(`Проверка не запустилась: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenShell
      screen="diagnostics"
      actions={
        <>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void refresh()}>
            Обновить
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void check()}>
            {busy ? "Проверяю…" : "Запустить проверку"}
          </Button>
        </>
      }
    >
      <SettingGroup title="Preflight" description={message}>
        {checks.length === 0 ? (
          <p className="px-3 py-3 text-caption text-muted-foreground">
            Выбранный провайдер речи: {settings.stt_provider}. Запустите проверку перед первой
            записью.
          </p>
        ) : (
          checks.map((checkResult) => (
            <SettingRow key={checkResult.step} label={checkResult.step} hint={checkResult.detail}>
              <span
                className={checkResult.status === "failed" ? "text-destructive" : "text-foreground"}
              >
                {STATUS_LABEL[checkResult.status]}
              </span>
            </SettingRow>
          ))
        )}
      </SettingGroup>

      <SettingGroup
        title="Последние события"
        description="Сохраняются только безопасные метаданные запросов."
      >
        {records.length === 0 ? (
          <p className="px-3 py-3 text-caption text-muted-foreground">Событий пока нет.</p>
        ) : (
          records.map((record) => <RecordRow key={record.id} record={record} />)
        )}
        {records.length > 0 && (
          <div className="flex justify-end px-3 py-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void clearDiagnostics().then(() => {
                  setRecords([]);
                });
              }}
            >
              Очистить
            </Button>
          </div>
        )}
      </SettingGroup>
    </ScreenShell>
  );
}
