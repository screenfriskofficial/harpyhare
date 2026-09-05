import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { SelectItem } from "@/components/ui/select";
import { SETTINGS_LIMITS } from "@/ipc/bindings";
import { listAudioOutputDevices } from "@/ipc/commands";
import type { AudioOutputDevice } from "@/ipc/types";
import { queryKeys } from "@/lib/query-client";
import { STT_PROVIDERS, sttProviderSupportsTranslate } from "@/lib/stt-providers";
import type { SectionProps } from "../contract";
import { SettingGroup, SettingRow, SettingSelect, SettingSlider, SettingSwitch } from "../fields";

const STT_LANGUAGE_AUTO = "auto";

/** Языки распознавания подписаны эндонимами — так их находят носители при любом языке интерфейса. */
const STT_LANGUAGES = [
  { value: "ru", label: "Русский" },
  { value: "en", label: "English" },
  { value: "uk", label: "Українська" },
  { value: "de", label: "Deutsch" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
];

const CAPTURE_DEVICE_SYSTEM_DEFAULT = "system-default";
const BUFFER_SECONDS_STEP = 1;

const AUDIO_DEVICES_STALE_MS = 30 * 1000;

function useAudioOutputDevices(): AudioOutputDevice[] {
  const { data } = useQuery({
    queryKey: queryKeys.audioDevices,
    queryFn: listAudioOutputDevices,
    staleTime: AUDIO_DEVICES_STALE_MS,
  });
  return data ?? [];
}

function withSavedDevice(
  devices: AudioOutputDevice[],
  savedUid: string,
  missingLabel: string,
): AudioOutputDevice[] {
  if (savedUid === "" || devices.some((d) => d.uid === savedUid)) return devices;
  return [...devices, { uid: savedUid, name: missingLabel }];
}

function CaptureDeviceRow({ draft, set }: SectionProps) {
  const { t } = useTranslation();
  const label = t("launcher.speech.device");
  const devices = withSavedDevice(
    useAudioOutputDevices(),
    draft.capture_device_uid,
    t("launcher.speech.missingDevice"),
  );
  return (
    <SettingRow label={label} hint={t("launcher.speech.deviceHint")}>
      <SettingSelect
        ariaLabel={label}
        value={
          draft.capture_device_uid === "" ? CAPTURE_DEVICE_SYSTEM_DEFAULT : draft.capture_device_uid
        }
        onValueChange={(v) => {
          set("capture_device_uid", v === CAPTURE_DEVICE_SYSTEM_DEFAULT ? "" : v);
        }}
      >
        <SelectItem value={CAPTURE_DEVICE_SYSTEM_DEFAULT}>
          {t("launcher.speech.systemOutput")}
        </SelectItem>
        {devices.map((d) => (
          <SelectItem key={d.uid} value={d.uid}>
            {d.name}
          </SelectItem>
        ))}
      </SettingSelect>
    </SettingRow>
  );
}

export function SttSection({ draft, set }: SectionProps) {
  const { t } = useTranslation();
  const translateAvailable = sttProviderSupportsTranslate(draft.stt_provider);
  const translatingNow = draft.stt_translate && translateAvailable;
  const providerLabel = t("launcher.speech.provider");
  const languageLabel = t("launcher.speech.language");
  const translateLabel = t("launcher.speech.translate");
  const bufferLabel = t("launcher.speech.buffer");
  const bufferDepthLabel = t("launcher.speech.bufferDepth");
  return (
    <SettingGroup title={t("launcher.speech.title")} description={t("launcher.speech.description")}>
      <CaptureDeviceRow draft={draft} set={set} />
      <SettingRow label={providerLabel} hint={t("launcher.speech.providerHint")}>
        <SettingSelect
          ariaLabel={providerLabel}
          value={draft.stt_provider}
          onValueChange={(v) => {
            set("stt_provider", v);
          }}
        >
          {STT_PROVIDERS.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.label}
            </SelectItem>
          ))}
        </SettingSelect>
      </SettingRow>
      <SettingRow
        label={languageLabel}
        hint={
          translatingNow ? t("launcher.speech.languageAutoHint") : t("launcher.speech.languageHint")
        }
      >
        <SettingSelect
          ariaLabel={languageLabel}
          value={draft.stt_language === "" ? STT_LANGUAGE_AUTO : draft.stt_language}
          disabled={translatingNow}
          onValueChange={(v) => {
            set("stt_language", v === STT_LANGUAGE_AUTO ? "" : v);
          }}
        >
          {STT_LANGUAGES.map((l) => (
            <SelectItem key={l.value} value={l.value}>
              {l.label}
            </SelectItem>
          ))}
          <SelectItem value={STT_LANGUAGE_AUTO}>{t("launcher.speech.autoDetect")}</SelectItem>
        </SettingSelect>
      </SettingRow>
      <SettingRow
        label={translateLabel}
        hint={
          translateAvailable
            ? t("launcher.speech.translateHint")
            : t("launcher.speech.translateUnavailable")
        }
      >
        <SettingSwitch
          ariaLabel={translateLabel}
          checked={draft.stt_translate && translateAvailable}
          disabled={!translateAvailable}
          onCheckedChange={(v) => {
            set("stt_translate", v);
          }}
        />
      </SettingRow>
      <SettingRow label={bufferLabel} hint={t("launcher.speech.bufferHint")}>
        <SettingSwitch
          ariaLabel={bufferLabel}
          checked={draft.buffer_enabled}
          onCheckedChange={(v) => {
            set("buffer_enabled", v);
          }}
        />
      </SettingRow>
      <SettingRow label={bufferDepthLabel} hint={t("launcher.speech.bufferDepthHint")}>
        <SettingSlider
          ariaLabel={bufferDepthLabel}
          value={draft.buffer_seconds}
          min={SETTINGS_LIMITS.bufferSeconds.min}
          max={SETTINGS_LIMITS.bufferSeconds.max}
          step={BUFFER_SECONDS_STEP}
          readout={t("units.secondsShort", { count: draft.buffer_seconds })}
          disabled={!draft.buffer_enabled}
          onChange={(v) => {
            set("buffer_seconds", v);
          }}
        />
      </SettingRow>
    </SettingGroup>
  );
}
