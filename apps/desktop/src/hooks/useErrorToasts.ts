import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { onEvent } from "@/ipc/events";
import type { AppError } from "@/lib/errors";
import { notifyAppError } from "@/lib/notify";
import { useCopyDiagnosticReport } from "./useDiagnostics";

/**
 * Shows the toast for an error by its code, with the diagnostics action. The
 * backend's error events go through it; the returned reporter is for failures
 * that arrive as a command result instead of an event (pipeline steps).
 */
export function useErrorToasts(): (error: AppError) => void {
  const { t } = useTranslation();
  const copy = useCopyDiagnosticReport();
  const show = useCallback(
    (error: AppError) => {
      notifyAppError(error, {
        label: t("diagnostics.copy"),
        run: () => {
          void copy();
        },
      });
    },
    [copy, t],
  );
  useEffect(() => onEvent("stt-error", show), [show]);
  useEffect(() => onEvent("screenshot-error", show), [show]);
  useEffect(() => onEvent("hotkey-error", show), [show]);
  useEffect(
    () =>
      onEvent("llm-error", ({ code, message }) => {
        show({ code, message });
      }),
    [show],
  );
  return show;
}
