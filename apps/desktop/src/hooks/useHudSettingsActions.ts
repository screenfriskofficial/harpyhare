import { useCallback, type RefObject } from "react";
import { t } from "@/i18n";
import type { Settings } from "@/ipc/types";
import { notify } from "@/lib/notify";
import { OPENROUTER_STT_PROVIDER } from "@/lib/stt-providers";

export interface HudSettingsActions {
  toggleScreenShareVisible: () => void;
  switchSttProvider: (provider: string) => void;
  selectOpenrouterSttModel: (model: string) => void;
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
            title: t("common.error"),
            message: t("errors.settingsSaveFailed", { error: err }),
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

  const selectOpenrouterSttModel = useCallback(
    (model: string) => {
      // One save: changing the model must also activate its provider without
      // racing a second settings write or briefly constructing the wrong client.
      saveReportingError({ stt_provider: OPENROUTER_STT_PROVIDER, openrouter_stt_model: model });
    },
    [saveReportingError],
  );

  const persistTeleprompter = useCallback(
    (speed: number, fontSize: number) => {
      saveReportingError({ teleprompter_speed: speed, teleprompter_font_size: fontSize });
    },
    [saveReportingError],
  );

  return {
    toggleScreenShareVisible,
    switchSttProvider,
    selectOpenrouterSttModel,
    skipVersion,
    persistTeleprompter,
  };
}
