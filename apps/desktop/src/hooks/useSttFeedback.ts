import { useCallback, useEffect, useState } from "react";
import { retryTranscription } from "@/ipc/commands";
import { onEvent } from "@/ipc/events";
import type { RecorderState } from "@/ipc/types";
import { isRetryable, type AppError } from "@/lib/errors";

export interface SttFeedback {
  sttError: AppError | null;
  /** Кнопка «Повторить распознавание» — только пока ошибка распознавания повторяема. */
  showRetry: boolean;
  /** Снимает и ошибку, и кнопку повтора: пользователь пошёл дальше (расшифровка, отправка). */
  clearSttFeedback: () => void;
  retry: () => void;
}

export function useSttFeedback(recorderState: RecorderState): SttFeedback {
  const [sttError, setSttError] = useState<AppError | null>(null);
  const [showRetry, setShowRetry] = useState(false);

  useEffect(
    () =>
      onEvent("stt-error", (err) => {
        setSttError(err);
        setShowRetry(isRetryable(err));
      }),
    [],
  );

  const clearSttFeedback = useCallback(() => {
    setSttError(null);
    setShowRetry(false);
  }, []);

  useEffect(() => {
    if (recorderState === "recording") clearSttFeedback();
  }, [recorderState, clearSttFeedback]);

  const retry = useCallback(() => {
    setShowRetry(false);
    void retryTranscription();
  }, []);

  return { sttError, showRetry, clearSttFeedback, retry };
}
