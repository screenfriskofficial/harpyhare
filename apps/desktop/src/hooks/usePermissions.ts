import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@/i18n";
import type { PermissionKind, PermissionsStatus } from "@/ipc/bindings";
import { openPermissionSettings, permissionsStatus, requestPermission } from "@/ipc/commands";
import { notify } from "@/lib/notify";

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
  const pendingRef = useRef<PermissionKind | null>(null);
  const revision = useRef(0);

  const refresh = useCallback(async () => {
    // A focus event can arrive while the native permission dialog is closing.
    // Its snapshot must not overwrite the result of the explicit request.
    if (pendingRef.current !== null) return;
    const current = ++revision.current;
    try {
      const next = await permissionsStatus();
      if (current !== revision.current) return;
      setStatus(next);
      setLoaded(true);
    } catch {
      if (current !== revision.current) return;
      notify({ message: t("launcher.permissions.checkFailed"), variant: "error" });
    }
  }, []);

  useEffect(() => {
    const revisionRef = revision;
    const onFocus = () => void refresh();
    onFocus();
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      ++revisionRef.current;
    };
  }, [refresh]);

  const request = useCallback(async (kind: PermissionKind) => {
    if (pendingRef.current !== null) return;
    pendingRef.current = kind;
    ++revision.current;
    setPending(kind);
    try {
      const state = await requestPermission(kind);
      setStatus((prev) => ({ ...prev, [kind]: state }));
    } catch {
      notify({ message: t("launcher.permissions.requestFailed"), variant: "error" });
    } finally {
      pendingRef.current = null;
      setPending(null);
    }
  }, []);

  const openSettings = useCallback((kind: PermissionKind) => {
    void openPermissionSettings(kind).catch(() => {
      notify({ message: t("launcher.permissions.settingsFailed"), variant: "error" });
    });
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
