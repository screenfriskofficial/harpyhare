import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { usePermissions, type PermissionsApi } from "@/hooks/usePermissions";
import type { Settings } from "@/ipc/types";
import { accessGaps, type AccessGap } from "@/lib/api-keys";
import type { ScreenId } from "./screens";
import type { SettingsTabId } from "./settings-tabs";

export interface LauncherBlocker {
  label: string;
  screen: ScreenId;
  tab?: SettingsTabId;
}

/** Ключи и выбор провайдера речи живут на одной вкладке, поэтому пробел любого рода ведёт сюда. */
const ACCESS_TAB: SettingsTabId = "access";

const AUDIO_BLOCKER_SCREEN: ScreenId = "permissions";

export interface LauncherReadiness {
  gaps: AccessGap[];
  permissions: PermissionsApi;
  blockers: LauncherBlocker[];
  checking: boolean;
  ready: boolean;
}

export function useLauncherReadiness(settings: Settings): LauncherReadiness {
  // `t` в зависимостях: подписи блокеров собираются из словаря и обязаны
  // пересчитаться при смене языка, а не только при смене настроек.
  const { t } = useTranslation();
  // Translation helpers read the active language; changing it invalidates this memo.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const gaps = useMemo(() => accessGaps(settings), [settings, t]);
  const permissions = usePermissions();
  const checking = !permissions.loaded;

  const blockers = useMemo(() => {
    const list: LauncherBlocker[] = gaps.map((gap) => ({
      label: gap.label,
      screen: "settings",
      tab: ACCESS_TAB,
    }));
    if (!checking && settings.capture_system_audio && !permissions.audioOk) {
      list.push({ label: t("launcher.audioBlocker"), screen: AUDIO_BLOCKER_SCREEN });
    }
    if (!settings.capture_system_audio && !settings.capture_microphone) {
      list.push({ label: t("launcher.speech.noSources"), screen: "settings", tab: "speech" });
    }
    if (!checking && settings.capture_microphone && !permissions.microphoneOk) {
      list.push({
        label: t("launcher.speech.microphonePermission"),
        screen: "settings",
        tab: "speech",
      });
    }
    return list;
  }, [
    gaps,
    checking,
    permissions.audioOk,
    permissions.microphoneOk,
    settings.capture_system_audio,
    settings.capture_microphone,
    t,
  ]);

  return {
    gaps,
    permissions,
    blockers,
    checking,
    ready: !checking && blockers.length === 0,
  };
}
