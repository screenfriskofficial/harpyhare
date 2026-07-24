import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useCapturePermission } from "@/hooks/useCapturePermission";
import { useScreenCapturePermission } from "@/hooks/useScreenCapturePermission";
import { listPlugins } from "@/ipc/commands";
import type { Settings } from "@/ipc/types";
import { missingApiKeys, type ApiKeyInfo } from "@/lib/api-keys";
import { queryKeys } from "@/lib/query-client";

const SCREEN_RECORDING_PERMISSION = "screen_recording";

export interface LauncherReadiness {
  missingKeys: ApiKeyInfo[];
  permissionOk: boolean;
  needsScreenRecording: boolean;
  screenCaptureOk: boolean;
  ready: boolean;
  requestPermission: () => Promise<void>;
  requestScreenCapture: () => Promise<void>;
  openScreenCaptureSettings: () => void;
}

export function useLauncherReadiness(settings: Settings): LauncherReadiness {
  const missingKeys = useMemo(() => missingApiKeys(settings), [settings]);
  const { permissionOk, requestPermission } = useCapturePermission();
  const { screenCaptureOk, requestScreenCapture, openScreenCaptureSettings } =
    useScreenCapturePermission();

  const { data: plugins } = useQuery({
    queryKey: queryKeys.plugins,
    queryFn: listPlugins,
    staleTime: Infinity,
  });

  const needsScreenRecording = useMemo(() => {
    const enabled = new Set(settings.plugin_settings.filter((p) => p.enabled).map((p) => p.id));
    return (plugins ?? []).some(
      (d) => enabled.has(d.id) && d.permissions.includes(SCREEN_RECORDING_PERMISSION),
    );
  }, [settings.plugin_settings, plugins]);

  const screenRecordingOk = !needsScreenRecording || screenCaptureOk;
  const ready = missingKeys.length === 0 && permissionOk && screenRecordingOk;

  return {
    missingKeys,
    permissionOk,
    needsScreenRecording,
    screenCaptureOk,
    ready,
    requestPermission,
    requestScreenCapture,
    openScreenCaptureSettings,
  };
}
