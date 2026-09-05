import { useTranslation } from "react-i18next";
import type { SectionProps } from "../contract";
import { SettingGroup, SettingRow, SettingSwitch } from "../fields";

/** Ключи словаря по имени настройки: подпись `launcher.behavior.<key>`, подсказка — `<key>Hint`. */
const TOGGLES = [
  { key: "screen_share_visible", text: "screenShare" },
  { key: "auto_send", text: "autoSend" },
  { key: "auto_preview_html", text: "autoPreview" },
  { key: "teleprompter_resume", text: "teleprompterResume" },
] as const satisfies readonly { key: keyof SectionProps["draft"]; text: string }[];

export function BehaviorSection({ draft, set }: SectionProps) {
  const { t } = useTranslation();
  return (
    <SettingGroup
      title={t("launcher.behavior.title")}
      description={t("launcher.behavior.description")}
    >
      {TOGGLES.map(({ key, text }) => {
        const label = t(`launcher.behavior.${text}`);
        return (
          <SettingRow key={key} label={label} hint={t(`launcher.behavior.${text}Hint`)}>
            <SettingSwitch
              ariaLabel={label}
              checked={draft[key]}
              onCheckedChange={(v) => {
                set(key, v);
              }}
            />
          </SettingRow>
        );
      })}
    </SettingGroup>
  );
}
