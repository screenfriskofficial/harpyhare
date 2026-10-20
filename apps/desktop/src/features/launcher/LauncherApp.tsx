import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useContextLibrary } from "@/hooks/useContextLibrary";
import { usePipelines } from "@/hooks/usePipelines";
import { useSettingsStore } from "@/hooks/useSettingsStore";
import { useUpdater } from "@/hooks/useUpdater";
import { applyUiLanguage } from "@/i18n";
import { launchMainWindow } from "@/ipc/commands";
import type { Settings } from "@/ipc/types";
import { errorMessage } from "@/lib/errors";
import { notifyError } from "@/lib/notify";
import { applyTheme } from "@/lib/window-controls";
import { LauncherPanel } from "./LauncherPanel";
import { useLauncherReadiness } from "./useLauncherReadiness";

function applyLauncherVisuals(settings: Settings): void {
  applyTheme(document.documentElement, settings.theme);
  applyUiLanguage(document.documentElement, settings.ui_language);
}

export function LauncherApp() {
  const { t } = useTranslation();
  const { settings, loading, save } = useSettingsStore(applyLauncherVisuals);
  const updater = useUpdater();
  const contextLibrary = useContextLibrary();
  const pipelines = usePipelines();
  const readiness = useLauncherReadiness(settings);
  const [launching, setLaunching] = useState(false);
  const [saving, setSaving] = useState(false);

  const persist = async (next: Settings): Promise<boolean> => {
    setSaving(true);
    try {
      const failure = await save(next);
      if (failure !== null) {
        notifyError(failure);
        return false;
      }
      return true;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = (next: Settings) => {
    void persist(next);
  };

  const handleLaunch = (next: Settings) => {
    if (!readiness.ready) return;
    setLaunching(true);
    void (async () => {
      try {
        if (await persist(next)) {
          await Promise.all([contextLibrary.flush(), pipelines.flush()]);
          await launchMainWindow();
          return;
        }
      } catch (e) {
        notifyError(errorMessage(e));
      }
      setLaunching(false);
    })();
  };

  if (loading)
    return (
      <div className="grid h-screen place-items-center text-body text-muted-foreground">
        {t("common.loading")}
      </div>
    );

  return (
    <LauncherPanel
      settings={settings}
      updater={updater}
      contextLibrary={contextLibrary}
      pipelines={pipelines}
      readiness={readiness}
      launching={launching}
      saving={saving}
      onCheckUpdates={updater.checkNow}
      onSave={handleSave}
      onPrepare={persist}
      onLaunch={handleLaunch}
    />
  );
}
