import { useCallback } from "react";
import { t } from "@/i18n";
import { stopMainWindow } from "@/ipc/commands";
import { errorMessage } from "@/lib/errors";
import { notifyError } from "@/lib/notify";

export interface LeaveToLauncherInput {
  flushChats: () => Promise<void>;
  flushLibrary: () => Promise<void>;
  flushSettings: () => Promise<void>;
  flushPipelines: () => Promise<void>;
  cancelPipelines: () => void;
}

/**
 * The «Стоп» button: every store writes its unsaved tail, and only then the
 * HUD window is destroyed. `Promise.all`, not `allSettled` — after a failed
 * write the window stays open with a toast, or `stop_main_window` would take
 * the webview down together with the data.
 */
export function useLeaveToLauncher({
  flushChats,
  flushLibrary,
  flushSettings,
  flushPipelines,
  cancelPipelines,
}: LeaveToLauncherInput): () => void {
  return useCallback(() => {
    cancelPipelines();
    void Promise.all([flushChats(), flushLibrary(), flushSettings(), flushPipelines()])
      .then(stopMainWindow)
      .catch((err: unknown) => {
        notifyError(t("errors.leaveSaveFailed", { error: errorMessage(err) }));
      });
  }, [flushChats, flushLibrary, flushSettings, flushPipelines, cancelPipelines]);
}
