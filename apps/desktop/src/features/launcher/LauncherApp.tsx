import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useContextLibrary } from "@/hooks/useContextLibrary";
import { useSettingsStore } from "@/hooks/useSettingsStore";
import { useUpdater } from "@/hooks/useUpdater";
import { applyUiLanguage } from "@/i18n";
import { clearAccessToken, launchMainWindow, redeemAccessCode } from "@/ipc/commands";
import type { Settings } from "@/ipc/types";
import { notify } from "@/lib/notify";
import { applyTheme } from "@/lib/window-controls";
import { LauncherPanel } from "./LauncherPanel";
import { useLauncherReadiness } from "./useLauncherReadiness";

function applyLauncherVisuals(settings: Settings): void {
  applyTheme(document.documentElement, settings.theme);
  applyUiLanguage(document.documentElement, settings.ui_language);
}

export function LauncherApp() {
  const { t } = useTranslation();
  const { settings, loading, save, reload } = useSettingsStore(applyLauncherVisuals);
  const updater = useUpdater();
  const contextLibrary = useContextLibrary();
  const readiness = useLauncherReadiness(settings);
  const [launching, setLaunching] = useState(false);
  const [saving, setSaving] = useState(false);

  const redeem = useCallback(
    async (code: string): Promise<string | null> => {
      const failure = await redeemAccessCode(code);
      if (failure === null) await reload();
      return failure;
    },
    [reload],
  );

  // Токен доступа принадлежит бэкенду: `set_settings` его не принимает, поэтому
  // отвязка идёт отдельной командой, а стор перечитывает применённые настройки.
  const unlink = useCallback(async (): Promise<void> => {
    try {
      await clearAccessToken();
      await reload();
    } catch (e) {
      notify({ variant: "error", title: t("common.error"), message: String(e) });
    }
  }, [reload, t]);

  const persist = async (next: Settings): Promise<boolean> => {
    setSaving(true);
    try {
      const failure = await save(next);
      if (failure !== null) {
        notify({ variant: "error", title: t("common.error"), message: failure });
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
          await launchMainWindow();
          return;
        }
      } catch (e) {
        notify({ variant: "error", title: t("common.error"), message: String(e) });
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
      readiness={readiness}
      launching={launching}
      saving={saving}
      onRedeem={redeem}
      onUnlink={unlink}
      onCheckUpdates={updater.checkNow}
      onSave={handleSave}
      onLaunch={handleLaunch}
    />
  );
}
