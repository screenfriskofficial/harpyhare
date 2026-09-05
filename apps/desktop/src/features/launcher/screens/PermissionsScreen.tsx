import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { PermissionsApi } from "@/hooks/usePermissions";
import type { PermissionState } from "@/ipc/bindings";
import { cn } from "@/lib/utils";
import { SettingGroup } from "../fields";
import {
  PERMISSION_ROWS,
  permissionPurpose,
  permissionTitle,
  type PermissionRow,
} from "../permission-rows";
import { ScreenShell } from "../ScreenShell";

function StatusChip({ state }: { state: PermissionState }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-caption text-muted-foreground">
      <span
        className={cn(
          "size-1.5 rounded-full",
          state === "granted" ? "bg-primary" : "bg-muted-foreground/40",
        )}
        aria-hidden
      />
      {t(`launcher.permissions.states.${state}`)}
    </span>
  );
}

function PermissionRowView({
  row,
  permissions,
}: {
  row: PermissionRow;
  permissions: PermissionsApi;
}) {
  const { t } = useTranslation();
  const state = permissions.status[row.kind];
  const granted = state === "granted";
  return (
    <div className="grid grid-cols-[1.25rem_minmax(0,1fr)_14rem] items-center gap-x-3 px-3 py-2.5">
      <row.icon
        className={cn("size-4.5", granted ? "text-foreground" : "text-muted-foreground")}
        aria-hidden
      />

      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-x-2">
          <span className="text-body">{permissionTitle(row.kind)}</span>
          <StatusChip state={state} />
          <span className="text-hint text-muted-foreground/80">
            {row.required ? t("launcher.permissions.required") : t("launcher.permissions.optional")}
          </span>
        </div>
        <p className="min-h-9 text-caption text-muted-foreground">{permissionPurpose(row.kind)}</p>
      </div>

      <div className="flex items-center justify-end gap-1.5">
        {!granted && (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                permissions.openSettings(row.kind);
              }}
            >
              {t("launcher.permissions.settings")}
            </Button>
            <Button
              size="sm"
              className="min-w-18"
              disabled={permissions.pending !== null}
              onClick={() => void permissions.request(row.kind)}
            >
              {permissions.pending === row.kind
                ? t("launcher.permissions.granting")
                : t("launcher.permissions.grant")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export function PermissionsScreen({ permissions }: { permissions: PermissionsApi }) {
  const { t } = useTranslation();
  return (
    <ScreenShell
      screen="permissions"
      actions={
        <Button variant="ghost" size="sm" onClick={() => void permissions.refresh()}>
          {t("launcher.permissions.recheck")}
        </Button>
      }
    >
      <SettingGroup
        title={t("launcher.permissions.title")}
        description={t("launcher.permissions.description")}
      >
        {PERMISSION_ROWS.map((row) => (
          <PermissionRowView key={row.kind} row={row} permissions={permissions} />
        ))}
      </SettingGroup>
    </ScreenShell>
  );
}
