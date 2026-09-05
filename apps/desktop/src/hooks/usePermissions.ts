import { useCallback, useEffect, useState } from "react";
import type { PermissionKind, PermissionsStatus } from "@/ipc/bindings";
import { openPermissionSettings, permissionsStatus, requestPermission } from "@/ipc/commands";

const UNKNOWN_STATUS: PermissionsStatus = {
  audio: "unknown",
  microphone: "unknown",
  screen: "unknown",
};

export interface PermissionsApi {
  status: PermissionsStatus;
  loaded: boolean;
  audioOk: boolean;
  microphoneOk: boolean;
  screenOk: boolean;
  allOk: boolean;
  needsAttention: boolean;
  pending: PermissionKind | null;
  request: (kind: PermissionKind) => Promise<void>;
  openSettings: (kind: PermissionKind) => void;
  refresh: () => Promise<void>;
}

export function usePermissions(): PermissionsApi {
  const [status, setStatus] = useState<PermissionsStatus>(UNKNOWN_STATUS);
  const [pending, setPending] = useState<PermissionKind | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    setStatus(await permissionsStatus());
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const request = useCallback(async (kind: PermissionKind) => {
    setPending(kind);
    try {
      const state = await requestPermission(kind);
      setStatus((prev) => ({ ...prev, [kind]: state }));
    } finally {
      setPending(null);
    }
  }, []);

  const openSettings = useCallback((kind: PermissionKind) => {
    void openPermissionSettings(kind);
  }, []);

  return {
    status,
    loaded,
    audioOk: status.audio === "granted",
    microphoneOk: status.microphone === "granted",
    screenOk: status.screen === "granted",
    allOk: status.audio === "granted" && status.screen === "granted",
    needsAttention: status.audio !== "granted" || status.screen === "unknown",
    pending,
    request,
    openSettings,
    refresh,
  };
}
