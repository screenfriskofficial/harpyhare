import { useEffect, useRef } from "react";
import { isNetworkError, type AppError } from "@/lib/errors";

/**
 * Raises the connectivity overlay the moment any surface reports a network
 * error, once per error object: the same error re-rendered must not probe again.
 */
export function useNetworkErrorReport(
  activeError: AppError | null,
  reportNetworkError: () => void,
): void {
  const reported = useRef<AppError | null>(null);
  useEffect(() => {
    if (!isNetworkError(activeError)) return;
    if (reported.current === activeError) return;
    reported.current = activeError;
    reportNetworkError();
  }, [activeError, reportNetworkError]);
}
