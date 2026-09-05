import { useCallback, type RefObject } from "react";
import type { Settings } from "@/ipc/types";
import { GENERIC_ERROR_TOAST_TITLE, notify } from "@/lib/notify";

const settingsSaveErrorText = (err: string) => `Ошибка сохранения настроек: ${err}`;

export interface HudSettingsActions {
  toggleScreenShareVisible: () => void;
  switchSttProvider: (provider: string) => void;
  skipVersion: (version: string) => void;
  persistTeleprompter: (speed: number, fontSize: number) => void;
}

/**
 * Точечные правки настроек из HUD. Каждая читает СВЕЖИЙ снимок из ref в момент
 * вызова, а не из замыкания рендера, и сообщает об ошибке записи тостом.
 */
export function useHudSettingsActions(
  settingsRef: RefObject<Settings>,
  save: (next: Settings) => Promise<string | null>,
  loading: boolean,
): HudSettingsActions {
  const saveReportingError = useCallback(
    (patch: Partial<Settings>) => {
      if (loading) return;
      void save({ ...settingsRef.current, ...patch }).then((err) => {
        if (err) {
          notify({
            variant: "error",
            title: GENERIC_ERROR_TOAST_TITLE,
            message: settingsSaveErrorText(err),
          });
        }
      });
    },
    [settingsRef, save, loading],
  );

  const toggleScreenShareVisible = useCallback(() => {
    saveReportingError({ screen_share_visible: !settingsRef.current.screen_share_visible });
  }, [saveReportingError, settingsRef]);

  const switchSttProvider = useCallback(
    (provider: string) => {
      saveReportingError({ stt_provider: provider });
    },
    [saveReportingError],
  );

  const skipVersion = useCallback(
    (version: string) => {
      saveReportingError({ skipped_version: version });
    },
    [saveReportingError],
  );

  const persistTeleprompter = useCallback(
    (speed: number, fontSize: number) => {
      saveReportingError({ teleprompter_speed: speed, teleprompter_font_size: fontSize });
    },
    [saveReportingError],
  );

  return { toggleScreenShareVisible, switchSttProvider, skipVersion, persistTeleprompter };
}
