import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Circle,
  Headphones,
  LoaderCircle,
  Mic,
  Play,
  RefreshCw,
  Settings2,
  Square,
  TriangleAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { SearchableSelect } from "@/components/SearchableSelect";
import { SectionLabel } from "@/components/SectionLabel";
import { Button } from "@/components/ui/button";
import type { CheckResult, CheckStep } from "@/ipc/bindings";
import type { Settings } from "@/ipc/types";
import { modelProvidersMissingKey } from "@/lib/api-keys";
import { modelGroups, modelLabel, type ModelInfo } from "@/lib/models";
import { STT_PROVIDERS } from "@/lib/stt-providers";
import { cn } from "@/lib/utils";
import type { LauncherDestination } from "../LauncherPanel";
import { ScreenShell } from "../ScreenShell";
import type { LauncherReadiness } from "../useLauncherReadiness";
import type { PreflightApi } from "../usePreflight";

function CheckRow({ check }: { check: CheckResult }) {
  const { t } = useTranslation();
  const Icon =
    check.status === "passed" ? CheckCircle2 : check.status === "failed" ? TriangleAlert : Circle;
  return (
    <div className="flex items-start gap-3 border-t py-3 first:border-0">
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          check.status === "passed"
            ? "text-primary"
            : check.status === "failed"
              ? "text-destructive"
              : "text-muted-foreground",
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="text-body font-medium">
            {t(`preflight.step.${check.step}`)}
            {check.source && ` · ${t(`preflight.step.${check.source}`)}`}
          </span>
          <span className="text-caption text-muted-foreground">
            {t(`preflight.${check.status}`)}
            {check.status !== "skipped" &&
              ` · ${t("diagnostics.milliseconds", { value: check.durationMs })}`}
          </span>
        </div>
        {check.errorCode && (
          <p className="text-caption leading-relaxed text-muted-foreground">
            {t(`diagnostics.errors.${check.errorCode}.title`)}.{" "}
            {t(`diagnostics.errors.${check.errorCode}.action`)}
          </p>
        )}
        {check.preview && (
          <p className="rounded bg-surface px-2.5 py-2 text-caption break-words">{check.preview}</p>
        )}
      </div>
    </div>
  );
}

function SourceCard({
  source,
  enabled,
  api,
  onConfigure,
}: {
  source: "systemAudio" | "microphone";
  enabled: boolean;
  api: PreflightApi;
  onConfigure: () => void;
}) {
  const { t } = useTranslation();
  const Icon = source === "systemAudio" ? Headphones : Mic;
  const level = api.progress?.levels.find((l) => l.source === source)?.percent ?? 0;
  const recording = enabled && api.progress?.phase === "recording";
  const checked = api.report?.checks.find((check) => check.step === source);
  return (
    <div className="space-y-3 rounded-lg border bg-card p-3.5">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" />
        <span className="flex-1 text-body font-medium">{t(`preflight.step.${source}`)}</span>
        <Button
          variant="ghost"
          size="compact"
          disabled={api.busy}
          onClick={onConfigure}
          aria-label={`${t("preflight.settings")}: ${t(`preflight.step.${source}`)}`}
        >
          <Settings2 className="size-3.5" />
        </Button>
      </div>
      <div
        role="meter"
        aria-label={t("preflight.level", { source: t(`preflight.step.${source}`) })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={level}
        className="h-1.5 overflow-hidden rounded-full bg-surface-active"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-100 motion-reduce:transition-none"
          style={{ width: `${String(level)}%` }}
        />
      </div>
      <p className="text-caption text-muted-foreground">
        {enabled
          ? recording
            ? t("preflight.remaining", {
                seconds: Math.ceil((api.progress?.remainingMs ?? 0) / 1000),
              })
            : checked
              ? t(`preflight.${checked.status}`)
              : t("preflight.notTested")
          : t("preflight.disabled")}
      </p>
    </div>
  );
}

export function PreflightScreen({
  api,
  settings,
  readiness,
  models,
  model,
  onModel,
  onNavigate,
  onLaunch,
}: {
  api: PreflightApi;
  settings: Settings;
  readiness: LauncherReadiness;
  models: ModelInfo[];
  model: string;
  onModel: (model: string) => void;
  onNavigate: (destination: LauncherDestination) => void;
  onLaunch: () => void;
}) {
  const { t } = useTranslation();
  const missing = modelProvidersMissingKey(settings);
  const groups = modelGroups(models, model);
  const canSelect = groups.some((g) => !missing.includes(g.id) && g.models.length > 0);
  const failed =
    (api.report?.checks.some((check) => check.status === "failed") ?? false) ||
    (!settings.capture_system_audio && !settings.capture_microphone);
  const speech = () => {
    onNavigate({ screen: "settings", tab: "speech" });
  };
  return (
    <ScreenShell
      screen="check"
      actions={
        <Button
          variant="ghost"
          size="compact"
          onClick={() => {
            onNavigate({ screen: "diagnostics" });
          }}
        >
          <Activity className="size-3.5" />
          {t("launcher.screens.diagnostics.label")}
        </Button>
      }
    >
      <div className="rounded-xl border bg-card p-4 sm:p-5">
        <SectionLabel>{t("preflight.eyebrow")}</SectionLabel>
        <h3 className="mt-2 text-title font-semibold tracking-tight">{t("preflight.title")}</h3>
        <p className="mt-2 max-w-2xl text-body leading-relaxed text-muted-foreground">
          {t("preflight.description")}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {api.busy ? (
            <Button
              onClick={() => {
                void api.cancel();
              }}
              disabled={api.cancelling}
            >
              <Square className="size-3.5" />
              {t(api.cancelling ? "preflight.cancelling" : "preflight.cancel")}
            </Button>
          ) : (
            <Button
              disabled={!canSelect || readiness.checking}
              onClick={() => {
                void api.run();
              }}
            >
              {api.report ? <RefreshCw className="size-3.5" /> : <Play className="size-3.5" />}
              {t(api.report ? "preflight.rerun" : "preflight.run")}
            </Button>
          )}
          {api.report && !failed && (
            <Button variant="outline" onClick={onLaunch} disabled={!readiness.ready || api.busy}>
              {t("preflight.launch")}
              <ArrowRight className="size-3.5" />
            </Button>
          )}
          <span
            role="status"
            className="flex items-center gap-2 text-caption text-muted-foreground"
          >
            {api.busy && (
              <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
            )}
            {api.progress
              ? t(`preflight.stage.${api.progress.phase}`)
              : api.report
                ? t(failed ? "preflight.needsAttention" : "preflight.ready")
                : api.error === "cancelled"
                  ? t("preflight.cancelled")
                  : api.stale
                    ? t("preflight.stale")
                    : null}
          </span>
        </div>
      </div>

      {readiness.blockers.length > 0 && (
        <div className="space-y-2 rounded-lg border border-destructive/30 p-3">
          {readiness.blockers.map((blocker) => (
            <div
              key={blocker.label}
              className="flex items-center justify-between gap-3 text-caption"
            >
              <span>{blocker.label}</span>
              <Button
                size="compact"
                variant="outline"
                disabled={api.busy}
                onClick={() => {
                  onNavigate(blocker);
                }}
              >
                {t("preflight.settings")}
                <ArrowRight className="size-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <SourceCard
          source="systemAudio"
          enabled={settings.capture_system_audio}
          api={api}
          onConfigure={speech}
        />
        <SourceCard
          source="microphone"
          enabled={settings.capture_microphone}
          api={api}
          onConfigure={speech}
        />
      </div>

      <div className="space-y-2 rounded-lg border bg-card p-3.5">
        <p className="text-body font-medium">{t("preflight.model")}</p>
        <SearchableSelect
          value={model}
          options={groups.flatMap((group) =>
            group.models.map((m) => ({
              value: m.id,
              label: modelLabel(m),
              group: group.label,
              description: m.id,
              disabled: missing.includes(group.id),
            })),
          )}
          ariaLabel={t("preflight.model")}
          placeholder={t("hud.modelMenu.placeholder")}
          emptyLabel={t("hud.modelMenu.empty")}
          disabled={api.busy || !canSelect}
          onValueChange={onModel}
        />
        {!canSelect && (
          <p className="text-caption text-muted-foreground">{t("preflight.noModels")}</p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-caption text-muted-foreground">
          <span>
            {t("preflight.step.transcription")}:{" "}
            {STT_PROVIDERS.find((provider) => provider.id === settings.stt_provider)?.label ??
              settings.stt_provider}
            {settings.stt_provider === "openrouter" && ` · ${settings.openrouter_stt_model}`}
          </span>
          <Button size="compact" variant="ghost" disabled={api.busy} onClick={speech}>
            {t("preflight.settings")}
            <ArrowRight className="size-3" />
          </Button>
        </div>
      </div>

      <div className="space-y-1.5 text-caption leading-relaxed text-muted-foreground">
        <p>{t("preflight.intro")}</p>
        <p>{t("preflight.phrase")}</p>
      </div>
      {api.error && api.error !== "cancelled" && (
        <p role="alert" className="text-body text-destructive">
          {t(`diagnostics.errors.${api.error}.action`)}
        </p>
      )}
      {api.report && (
        <div className="rounded-lg border bg-card px-3.5">
          {[...api.report.checks]
            .sort((a, b) => ORDER.indexOf(a.step) - ORDER.indexOf(b.step))
            .map((check) => (
              <CheckRow key={`${check.step}-${check.source ?? ""}`} check={check} />
            ))}
        </div>
      )}
      {api.report && (
        <p className="text-caption text-muted-foreground">{t("preflight.snapshot")}</p>
      )}
    </ScreenShell>
  );
}

const ORDER: CheckStep[] = ["systemAudio", "microphone", "transcription", "answer"];
