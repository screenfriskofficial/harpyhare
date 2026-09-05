import { AudioLines, Mic, Monitor, type LucideIcon } from "lucide-react";
import { t } from "@/i18n";
import type { PermissionKind } from "@/ipc/bindings";

/** Реестр без текста: название и назначение доступа переводятся по `kind`. */
export interface PermissionRow {
  kind: PermissionKind;
  icon: LucideIcon;
  required: boolean;
}

export const PERMISSION_ROWS: PermissionRow[] = [
  { kind: "audio", icon: AudioLines, required: false },
  { kind: "microphone", icon: Mic, required: false },
  { kind: "screen", icon: Monitor, required: false },
];

export function permissionTitle(kind: PermissionKind): string {
  return t(`launcher.permissions.rows.${kind}.title`);
}

export function permissionPurpose(kind: PermissionKind): string {
  return t(`launcher.permissions.rows.${kind}.purpose`);
}
