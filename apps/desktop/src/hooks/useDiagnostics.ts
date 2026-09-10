import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { clearDiagnostics, getDiagnostics } from "@/ipc/commands";
import { copyTextReportingError } from "@/lib/clipboard-text";
import { notify } from "@/lib/notify";
import { queryKeys } from "@/lib/query-client";

const REFRESH_INTERVAL_MS = 2000;

export function useCopyDiagnosticReport() {
  const { t } = useTranslation();
  return useCallback(async () => {
    try {
      // Fetch on click: an error toast must include the request that just failed.
      const report = await getDiagnostics();
      if (await copyTextReportingError(JSON.stringify(report, null, 2))) {
        notify({ variant: "success", message: t("diagnostics.copied") });
      }
    } catch {
      notify({ variant: "error", message: t("diagnostics.loadFailed") });
    }
  }, [t]);
}

export function useDiagnostics() {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: queryKeys.diagnostics,
    queryFn: getDiagnostics,
    staleTime: 0,
    refetchInterval: REFRESH_INTERVAL_MS,
  });
  const copy = useCopyDiagnosticReport();
  const clear = async () => {
    try {
      await clearDiagnostics();
      await query.refetch();
    } catch {
      notify({ variant: "error", message: t("diagnostics.loadFailed") });
    }
  };
  return { ...query, copy, clear };
}
