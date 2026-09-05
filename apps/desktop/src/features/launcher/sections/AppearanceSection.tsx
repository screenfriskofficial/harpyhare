import { useTranslation } from "react-i18next";
import { SelectItem } from "@/components/ui/select";
import { applyUiLanguage, UI_LANGUAGE_SYSTEM } from "@/i18n";
import { SETTINGS_LIMITS, UI_LANGUAGES } from "@/ipc/bindings";
import { applyTheme, THEME_BLACK, THEME_GRAY } from "@/lib/window-controls";
import type { SectionProps } from "../contract";
import { SettingGroup, SettingRow, SettingSelect, SettingSlider } from "../fields";

const CHAT_FONT_SIZE_STEP = 0.5;
const WINDOW_OPACITY_STEP = 0.05;
const PERCENT_SCALE = 100;
/**
 * Radix Select не принимает пустую строку значением пункта, а «как в системе»
 * в настройках хранится именно как `""` — тот же приём, что у устройства захвата.
 */
const LANGUAGE_SYSTEM_VALUE = "system";

function formatPercent(fraction: number): string {
  return `${String(Math.round(fraction * PERCENT_SCALE))}%`;
}

function LanguageRow({ draft, set }: SectionProps) {
  const { t } = useTranslation();
  const label = t("launcher.appearance.language");
  return (
    <SettingRow label={label} hint={t("launcher.appearance.languageHint")}>
      <SettingSelect
        ariaLabel={label}
        value={draft.ui_language === UI_LANGUAGE_SYSTEM ? LANGUAGE_SYSTEM_VALUE : draft.ui_language}
        onValueChange={(v) => {
          const next = v === LANGUAGE_SYSTEM_VALUE ? UI_LANGUAGE_SYSTEM : v;
          set("ui_language", next);
          // Как у темы: применяется сразу, не дожидаясь автосохранения черновика.
          applyUiLanguage(document.documentElement, next);
        }}
      >
        <SelectItem value={LANGUAGE_SYSTEM_VALUE}>
          {t("launcher.appearance.languageSystem")}
        </SelectItem>
        {UI_LANGUAGES.map((language) => (
          <SelectItem key={language} value={language}>
            {t(`launcher.appearance.languageNames.${language}`)}
          </SelectItem>
        ))}
      </SettingSelect>
    </SettingRow>
  );
}

export function AppearanceSection({ draft, set }: SectionProps) {
  const { t } = useTranslation();
  const themeLabel = t("launcher.appearance.theme");
  const fontSizeLabel = t("launcher.appearance.fontSize");
  const opacityLabel = t("launcher.appearance.opacity");
  return (
    <SettingGroup
      title={t("launcher.appearance.title")}
      description={t("launcher.appearance.description")}
    >
      <SettingRow label={themeLabel} hint={t("launcher.appearance.themeHint")}>
        <SettingSelect
          ariaLabel={themeLabel}
          value={draft.theme === THEME_BLACK ? THEME_BLACK : THEME_GRAY}
          onValueChange={(v) => {
            set("theme", v);
            applyTheme(document.documentElement, v);
          }}
        >
          <SelectItem value={THEME_GRAY}>{t("launcher.appearance.gray")}</SelectItem>
          <SelectItem value={THEME_BLACK}>{t("launcher.appearance.black")}</SelectItem>
        </SettingSelect>
      </SettingRow>
      <LanguageRow draft={draft} set={set} />
      <SettingRow label={fontSizeLabel} hint={t("launcher.appearance.fontSizeHint")}>
        <SettingSlider
          ariaLabel={fontSizeLabel}
          value={draft.chat_font_size}
          min={SETTINGS_LIMITS.chatFontSize.min}
          max={SETTINGS_LIMITS.chatFontSize.max}
          step={CHAT_FONT_SIZE_STEP}
          readout={`${String(draft.chat_font_size)}px`}
          onChange={(v) => {
            set("chat_font_size", v);
          }}
        />
      </SettingRow>
      <SettingRow label={opacityLabel} hint={t("launcher.appearance.opacityHint")}>
        <SettingSlider
          ariaLabel={opacityLabel}
          value={draft.window_opacity}
          min={SETTINGS_LIMITS.windowOpacity.min}
          max={SETTINGS_LIMITS.windowOpacity.max}
          step={WINDOW_OPACITY_STEP}
          displayScale={PERCENT_SCALE}
          readout={formatPercent(draft.window_opacity)}
          onChange={(v) => {
            set("window_opacity", v);
          }}
        />
      </SettingRow>
    </SettingGroup>
  );
}
