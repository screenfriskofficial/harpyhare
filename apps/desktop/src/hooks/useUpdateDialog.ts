import { useCallback, useMemo, useState } from "react";
import type { UpdateBadge } from "@/components/AppHeader";
import type { UpdateInfo } from "@/ipc/types";
import type { UpdaterApi, UpdaterStatus } from "./useUpdater";

export interface UpdateDialogState {
  /** What the header shows about the update; `null` while there is nothing to show. */
  badge: UpdateBadge | null;
  open: boolean;
  openUpdate: () => void;
  closeUpdate: () => void;
  /** Dismisses the update and remembers its version so the badge stays quiet. */
  skipUpdate: () => void;
}

function updateBadge(status: UpdaterStatus, info: UpdateInfo | null): UpdateBadge | null {
  if (status === "idle" || !info) return null;
  return { version: info.version, busy: status === "downloading" || status === "restarting" };
}

/** The HUD's update badge and dialog on top of `useUpdater`. */
export function useUpdateDialog(
  updater: UpdaterApi,
  skipVersion: (version: string) => void,
): UpdateDialogState {
  const [open, setOpen] = useState(false);
  const { status, info } = updater;
  const badge = useMemo(() => updateBadge(status, info), [status, info]);
  const skipUpdate = useCallback(() => {
    const skipped = updater.info?.version ?? "";
    setOpen(false);
    updater.dismiss();
    skipVersion(skipped);
  }, [updater, skipVersion]);
  const openUpdate = useCallback(() => {
    setOpen(true);
  }, []);
  const closeUpdate = useCallback(() => {
    setOpen(false);
  }, []);
  return { badge, open, openUpdate, closeUpdate, skipUpdate };
}
