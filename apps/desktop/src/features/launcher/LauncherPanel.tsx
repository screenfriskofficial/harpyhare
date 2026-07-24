import { Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { EqBars } from "@/components/EqBars";
import { Button } from "@/components/ui/button";
import { WarningBanner } from "@/components/WarningBanner";
import { DEFAULT_SETTINGS, type Settings } from "@/ipc/types";
import { missingKeysNotice } from "@/lib/api-keys";
import { BRAND_NAME } from "@/lib/brand";
import { isPresetFilled } from "@/lib/presets";
import type { LauncherPanelProps, SetSetting } from "./contract";
import { RequirementsDialog } from "./RequirementsDialog";
import type { PresetsUpdate } from "./sections/PresetsSection";
import { TabContent } from "./TabContent";
import { TabRail } from "./TabRail";
import type { TabId } from "./tabs";
import type { CheckState } from "./VersionRow";
import { VersionRow } from "./VersionRow";

const RISE_STEP_MS = 70;

const AUTOSAVE_DEBOUNCE_MS = 600;

function riseDelay(order: number): CSSProperties {
  return { animationDelay: `${String(order * RISE_STEP_MS)}ms` };
}

function normalizeDraft(draft: Settings): Settings {
  return {
    ...draft,
    hotkey: draft.hotkey.trim() || DEFAULT_SETTINGS.hotkey,
    toggle_hotkey: draft.toggle_hotkey.trim() || DEFAULT_SETTINGS.toggle_hotkey,
    teleprompter_hotkey: draft.teleprompter_hotkey.trim() || DEFAULT_SETTINGS.teleprompter_hotkey,
    prompt_presets: draft.prompt_presets.filter(isPresetFilled),
  };
}

export function LauncherPanel({
  settings,
  appVersion,
  contextLibrary,
  readiness,
  launching,
  error,
  onOpenAudioSettings,
  onRedeem,
  onCheckUpdates,
  onSave,
  onLaunch,
}: LauncherPanelProps) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [checkState, setCheckState] = useState<CheckState>("idle");
  const [tab, setTab] = useState<TabId>("main");
  const [requirementsOpen, setRequirementsOpen] = useState(false);

  const {
    ready,
    missingKeys,
    permissionOk,
    requestPermission,
    needsScreenRecording,
    screenCaptureOk,
    requestScreenCapture,
    openScreenCaptureSettings,
  } = readiness;

  useEffect(() => {
    setDraft((d) =>
      d.access_token === settings.access_token ? d : { ...d, access_token: settings.access_token },
    );
  }, [settings.access_token]);

  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  const lastQueuedDraft = useRef(draft);
  useEffect(() => {
    if (launching || draft === lastQueuedDraft.current) return;
    lastQueuedDraft.current = draft;
    const timer = setTimeout(() => {
      onSaveRef.current(normalizeDraft(draft));
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [draft, launching]);

  const checkUpdates = () => {
    setCheckState("checking");
    onCheckUpdates()
      .then((found) => {
        setCheckState(found ? "idle" : "latest");
      })
      .catch(() => {
        setCheckState("error");
      });
  };

  const set: SetSetting = (key, value) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const changePresets = (update: PresetsUpdate) => {
    setDraft((d) => ({ ...d, prompt_presets: update(d.prompt_presets) }));
  };

  return (
    <div className="flex h-screen flex-col gap-4 p-4 sm:p-6">
      <header className="launcher-rise flex items-center gap-3 border-b pb-3" style={riseDelay(0)}>
        <EqBars animated={launching} barClass="bg-primary" />
        <h1 className="font-mono text-body font-semibold tracking-[0.18em] uppercase">
          {BRAND_NAME}
        </h1>
        <span className="hidden text-caption text-muted-foreground sm:inline">
          Настройте параметры и запустите приложение
        </span>
      </header>

      <div className="flex min-h-0 min-w-0 flex-1 gap-3 md:gap-5">
        <div className="launcher-rise flex min-h-0" style={riseDelay(1)}>
          <TabRail active={tab} onSelect={setTab} />
        </div>
        <div
          className="launcher-rise min-h-0 min-w-0 flex-1 overflow-y-auto py-1 pr-1.5"
          style={riseDelay(2)}
        >
          <TabContent
            tab={tab}
            draft={draft}
            set={set}
            contextLibrary={contextLibrary}
            currentIdentityId={settings.identity_id}
            onRedeem={onRedeem}
            onPresetsChange={changePresets}
          />
        </div>
      </div>

      {!ready && (
        <div className="launcher-rise flex flex-col gap-2" style={riseDelay(3)}>
          {missingKeys.length > 0 && (
            <WarningBanner
              tone="info"
              actionLabel="Настроить"
              onAction={() => {
                setTab("main");
              }}
            >
              {missingKeysNotice(missingKeys)}
            </WarningBanner>
          )}
          {!permissionOk && (
            <WarningBanner actionLabel="Разрешить" onAction={() => void requestPermission()}>
              <span className="inline-flex items-center gap-2">
                Нет разрешения на запись системного звука
                <button
                  type="button"
                  className="underline underline-offset-2 hover:no-underline"
                  onClick={onOpenAudioSettings}
                >
                  открыть настройки
                </button>
              </span>
            </WarningBanner>
          )}
          {needsScreenRecording && !screenCaptureOk && (
            <WarningBanner actionLabel="Запросить" onAction={() => void requestScreenCapture()}>
              <span className="inline-flex items-center gap-2">
                Нет разрешения «Запись экрана» (нужно для harpyshot)
                <button
                  type="button"
                  className="underline underline-offset-2 hover:no-underline"
                  onClick={openScreenCaptureSettings}
                >
                  открыть настройки
                </button>
              </span>
            </WarningBanner>
          )}
        </div>
      )}

      <footer
        className="launcher-rise flex flex-wrap items-center justify-between gap-3 border-t pt-3"
        style={riseDelay(4)}
      >
        <VersionRow appVersion={appVersion} checkState={checkState} onCheck={checkUpdates} />
        <div className="flex min-w-0 items-center gap-2.5">
          {error !== null && (
            <span className="min-w-0 truncate text-caption text-destructive" title={error}>
              {error}
            </span>
          )}
          <Button
            disabled={launching}
            className="gap-2 px-5"
            onClick={() => {
              if (ready) onLaunch(normalizeDraft(draft));
              else setRequirementsOpen(true);
            }}
          >
            <Play className="size-4" aria-hidden />
            {launching ? "Запускаю…" : "Запустить"}
          </Button>
        </div>
      </footer>

      <RequirementsDialog
        open={requirementsOpen}
        onOpenChange={setRequirementsOpen}
        missingKeys={missingKeys}
        audioOk={permissionOk}
        needsScreenRecording={needsScreenRecording}
        screenCaptureOk={screenCaptureOk}
        onConfigureKeys={() => {
          setTab("main");
          setRequirementsOpen(false);
        }}
        onRequestAudio={() => void requestPermission()}
        onOpenAudioSettings={onOpenAudioSettings}
        onRequestScreen={() => void requestScreenCapture()}
        onOpenScreenSettings={openScreenCaptureSettings}
      />
    </div>
  );
}
