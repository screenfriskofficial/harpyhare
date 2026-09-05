import { useTranslation } from "react-i18next";
import { SelectItem } from "@/components/ui/select";
import type { PermissionsApi } from "@/hooks/usePermissions";
import { SETTINGS_LIMITS } from "@/ipc/bindings";
import { STT_PROVIDERS, sttProviderSupportsTranslate } from "@/lib/stt-providers";
import type { SectionProps } from "../contract";
import { SettingGroup, SettingRow, SettingSelect, SettingSlider, SettingSwitch } from "../fields";
import { AudioRouting } from "./AudioRouting";
import { AudioSources } from "./AudioSources";

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

const BUFFER_SECONDS_STEP = 1;

export function SttSection({
  draft,
  set,
  permissions,
}: SectionProps & { permissions: PermissionsApi }) {
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
      <AudioSources draft={draft} set={set} permissions={permissions} />
      <AudioRouting draft={draft} set={set} />
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
      {draft.capture_system_audio && (
        <>
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
        </>
      )}
    </SettingGroup>
  );
}
