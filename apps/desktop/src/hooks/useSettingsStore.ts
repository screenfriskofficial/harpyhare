import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { getSettings, setSettings as ipcSet } from "@/ipc/commands";
import { DEFAULT_SETTINGS, type Settings } from "@/ipc/types";
import { useLatestRef } from "./useLatestRef";

export type ApplyVisualSettings = (settings: Settings) => void;

/**
 * Патч, накопившийся ПОКА шла запись: хоткей прозрачности или ресайз мышью,
 * нажатые между отправкой `set_settings` и ответом. Накладывается поверх
 * ответа Rust, иначе `adopt` откатил бы state и CSS на снимок до нажатия, а
 * отложенный персист потом дописал бы патч на диск — state и файл разъехались бы.
 */
export type LatePatch = () => Partial<Settings> | null;

export interface SettingsStore {
  settings: Settings;
  setSettings: Dispatch<SetStateAction<Settings>>;
  loading: boolean;
  save: (next: Settings, latePatch?: LatePatch) => Promise<string | null>;
  reload: () => Promise<void>;
}

export function useSettingsStore(applyVisuals: ApplyVisualSettings): SettingsStore {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const applyVisualsRef = useLatestRef(applyVisuals);
  const lastAdopted = useLatestRef(settings);

  const adopt = useCallback(
    (fresh: Settings) => {
      setSettings(fresh);
      applyVisualsRef.current(fresh);
    },
    [applyVisualsRef],
  );

  useEffect(() => {
    let live = true;
    void getSettings()
      .then((s) => {
        if (live) adopt(s);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [adopt]);

  const save = useCallback(
    async (next: Settings, latePatch?: LatePatch): Promise<string | null> => {
      try {
        const fresh = await ipcSet(next);
        const late = latePatch?.() ?? null;
        adopt(late === null ? fresh : { ...fresh, ...late });
        return null;
      } catch (e) {
        applyVisualsRef.current(lastAdopted.current);
        return String(e);
      }
    },
    [adopt, applyVisualsRef, lastAdopted],
  );

  const reload = useCallback(async (): Promise<void> => {
    adopt(await getSettings());
  }, [adopt]);

  return { settings, setSettings, loading, save, reload };
}
