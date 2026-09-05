import { useCallback, useEffect, useState } from "react";
import { captureRegionScreenshot } from "@/ipc/commands";
import { onEvent } from "@/ipc/events";
import type { AppError } from "@/lib/errors";
import { useLatestRef } from "./useLatestRef";

export interface RegionScreenshotApi {
  error: AppError | null;
  clearError: () => void;
  capture: () => void;
}

export function useRegionScreenshot(
  onImage: (dataUrl: string, mediaType: string) => void,
): RegionScreenshotApi {
  const [error, setError] = useState<AppError | null>(null);
  const onImageRef = useLatestRef(onImage);

  useEffect(
    () =>
      onEvent("screenshot-ready", (p) => {
        setError(null);
        onImageRef.current(`data:${p.mediaType};base64,${p.dataBase64}`, p.mediaType);
      }),
    [onImageRef],
  );

  useEffect(() => onEvent("screenshot-error", setError), []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const capture = useCallback(() => {
    void captureRegionScreenshot();
  }, []);

  return { error, clearError, capture };
}
