import { Headphones } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { PermissionsApi } from "@/hooks/usePermissions";
import { notify } from "@/lib/notify";
import type { SectionProps } from "../contract";
import { SettingRow, SettingSwitch } from "../fields";

export function AudioSources({
  draft,
  set,
  permissions,
}: SectionProps & { permissions: PermissionsApi }) {
  const { t } = useTranslation();
  const requestMicrophone = async () => {
    try {
      await permissions.request("microphone");
    } catch (error) {
      notify({ variant: "error", title: t("common.error"), message: String(error) });
    }
  };
  return (
    <>
      <SettingRow
        label={t("launcher.speech.systemSource")}
        hint={t("launcher.speech.systemSourceHint")}
        className="py-3"
      >
        <SettingSwitch
          ariaLabel={t("launcher.speech.systemSource")}
          checked={draft.capture_system_audio}
          onCheckedChange={(value) => {
            set("capture_system_audio", value);
          }}
        />
      </SettingRow>
      <SettingRow
        label={t("launcher.speech.microphoneSource")}
        hint={t("launcher.speech.microphoneSourceHint")}
        className="py-3"
      >
        <SettingSwitch
          ariaLabel={t("launcher.speech.microphoneSource")}
          checked={draft.capture_microphone}
          onCheckedChange={(value) => {
            set("capture_microphone", value);
          }}
        />
      </SettingRow>
      {!draft.capture_system_audio && !draft.capture_microphone && (
        <p role="alert" className="px-3 py-3 text-caption leading-relaxed text-destructive">
          {t("launcher.speech.noSources")}
        </p>
      )}
      {draft.capture_microphone && (
        <div className="flex items-start gap-2.5 bg-muted/20 px-3 py-3 text-muted-foreground">
          <Headphones aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <p className="text-caption leading-relaxed">{t("launcher.speech.separationHint")}</p>
        </div>
      )}
      {draft.capture_microphone && (
        <SettingRow
          label={t("launcher.speech.microphonePermission")}
          hint={t(`launcher.permissions.states.${permissions.status.microphone}`)}
          className="py-3"
        >
          <div className="flex flex-wrap justify-end gap-2">
            {!permissions.microphoneOk && (
              <Button
                size="sm"
                disabled={permissions.pending !== null}
                onClick={() => void requestMicrophone()}
              >
                {permissions.pending === "microphone"
                  ? t("launcher.permissions.granting")
                  : t("launcher.permissions.grant")}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                permissions.openSettings("microphone");
              }}
            >
              {t("launcher.permissions.settings")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void permissions.refresh()}>
              {t("launcher.permissions.recheck")}
            </Button>
          </div>
        </SettingRow>
      )}
    </>
  );
}
