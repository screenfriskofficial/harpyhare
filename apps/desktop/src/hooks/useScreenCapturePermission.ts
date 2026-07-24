import { useCallback, useEffect, useState } from "react";
import {
  openScreenCaptureSettings,
  requestScreenCapturePermission,
  screenCaptureAvailable,
} from "@/ipc/commands";

export interface ScreenCapturePermission {
  screenCaptureOk: boolean;
  requestScreenCapture: () => Promise<void>;
  openScreenCaptureSettings: () => void;
  refreshScreenCapture: () => Promise<void>;
}

export function useScreenCapturePermission(): ScreenCapturePermission {
  const [screenCaptureOk, setScreenCaptureOk] = useState(false);

  const refreshScreenCapture = useCallback(async () => {
    setScreenCaptureOk(await screenCaptureAvailable());
  }, []);

  useEffect(() => {
    void refreshScreenCapture();
  }, [refreshScreenCapture]);

  const requestScreenCapture = useCallback(async () => {
    setScreenCaptureOk(await requestScreenCapturePermission());
  }, []);

  const openSettings = useCallback(() => {
    void openScreenCaptureSettings();
  }, []);

  return {
    screenCaptureOk,
    requestScreenCapture,
    openScreenCaptureSettings: openSettings,
    refreshScreenCapture,
  };
}
