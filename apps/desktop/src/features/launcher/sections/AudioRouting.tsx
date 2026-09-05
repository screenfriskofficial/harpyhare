import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { SelectItem } from "@/components/ui/select";
import type { AudioDeviceInfo } from "@/ipc/bindings";
import { listAudioDevices } from "@/ipc/commands";
import { queryKeys } from "@/lib/query-client";
import type { SectionProps } from "../contract";
import { SettingRow, SettingSelect } from "../fields";

const SYSTEM_DEFAULT = "system-default";

function DeviceSelect({
  label,
  hint,
  uid,
  devices,
  loaded,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  uid: string;
  devices: AudioDeviceInfo[];
  loaded: boolean;
  disabled: boolean;
  onChange: (uid: string) => void;
}) {
  const { t } = useTranslation();
  const savedMissing = uid !== "" && !devices.some((device) => device.uid === uid);
  const currentDefault = devices.find((device) => device.is_default);
  return (
    <div>
      <SettingRow label={label} hint={hint} className="py-3">
        <SettingSelect
          ariaLabel={label}
          value={uid || SYSTEM_DEFAULT}
          disabled={disabled}
          onValueChange={(value) => {
            onChange(value === SYSTEM_DEFAULT ? "" : value);
          }}
        >
          <SelectItem value={SYSTEM_DEFAULT}>
            {currentDefault
              ? t("launcher.speech.defaultDeviceNamed", { name: currentDefault.name })
              : t("launcher.speech.defaultDevice")}
          </SelectItem>
          {devices.map((device) => (
            <SelectItem key={device.uid} value={device.uid}>
              {device.name}
            </SelectItem>
          ))}
          {savedMissing && (
            <SelectItem value={uid} disabled>
              {loaded ? t("launcher.speech.missingDevice") : t("launcher.speech.loadingDevices")}
            </SelectItem>
          )}
        </SettingSelect>
      </SettingRow>
      {loaded && savedMissing && (
        <p role="alert" className="px-3 pb-3 text-caption leading-relaxed text-destructive">
          {t("launcher.speech.selectedDeviceUnavailable", { source: label })}
        </p>
      )}
    </div>
  );
}

export function AudioRouting({ draft, set }: SectionProps) {
  const { t } = useTranslation();
  const enabled = draft.capture_system_audio || draft.capture_microphone;
  const devices = useQuery({
    queryKey: queryKeys.audioDevices,
    queryFn: listAudioDevices,
    enabled,
    staleTime: 5_000,
    refetchOnWindowFocus: true,
  });
  if (!enabled) return null;
  const loaded = devices.data !== undefined && !devices.isError;
  const disabled = devices.isPending || devices.isError;
  return (
    <>
      {draft.capture_system_audio && (
        <DeviceSelect
          label={t("launcher.speech.device")}
          hint={t("launcher.speech.deviceHint")}
          uid={draft.capture_device_uid}
          devices={devices.data?.outputs ?? []}
          loaded={loaded}
          disabled={disabled}
          onChange={(uid) => {
            set("capture_device_uid", uid);
          }}
        />
      )}
      {draft.capture_microphone && (
        <DeviceSelect
          label={t("launcher.speech.microphoneDevice")}
          hint={t("launcher.speech.microphoneDeviceHint")}
          uid={draft.microphone_device_uid}
          devices={devices.data?.inputs ?? []}
          loaded={loaded}
          disabled={disabled}
          onChange={(uid) => {
            set("microphone_device_uid", uid);
          }}
        />
      )}
      <div className="flex flex-col items-start gap-3 bg-muted/20 px-3 py-3">
        {devices.isError && (
          <p role="alert" className="text-caption leading-relaxed text-destructive">
            {t("launcher.speech.devicesLoadError")}
          </p>
        )}
        <p className="text-caption leading-relaxed text-muted-foreground">
          {t("launcher.speech.virtualDeviceHint")}
        </p>
        <Button
          size="sm"
          variant="ghost"
          disabled={devices.isFetching}
          onClick={() => void devices.refetch()}
        >
          {t("launcher.speech.refreshDevices")}
        </Button>
      </div>
    </>
  );
}
