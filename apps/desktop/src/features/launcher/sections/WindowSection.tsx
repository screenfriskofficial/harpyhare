import { useTranslation } from "react-i18next";
import { SelectItem } from "@/components/ui/select";
import { MODIFIER_COMBOS, SETTINGS_LIMITS } from "@/ipc/bindings";
import { actionLabel, effectiveCombo, formatCombo, type HotkeyActionId } from "@/lib/hotkeys";
import { PLATFORM } from "@/lib/platform";
import type { SectionProps } from "../contract";
import { SettingBlock, SettingGroup, SettingSelect, SettingSlider } from "../fields";
import { useHotkeyEditor } from "../useHotkeyEditor";
import { StolenNote } from "./HotkeysSection";

/** Подсказка пары — `launcher.window.pairs.<action>`; тот же ключ индексирует поиск лаунчера. */
export const WINDOW_PAIRS = [
  { action: "move_window", stepKey: "move_step", limits: SETTINGS_LIMITS.moveStep },
  { action: "resize_window", stepKey: "resize_step", limits: SETTINGS_LIMITS.resizeStep },
  { action: "scroll_chat", stepKey: "scroll_step", limits: SETTINGS_LIMITS.scrollStep },
] as const satisfies readonly {
  action: HotkeyActionId;
  stepKey: keyof SectionProps["draft"];
  limits: { min: number; max: number };
}[];

const STEP_GRANULARITY = 5;
const PLATFORM_MODIFIERS: readonly string[] = MODIFIER_COMBOS[PLATFORM];

export function WindowSection({ draft, set }: SectionProps) {
  const { t } = useTranslation();
  const editor = useHotkeyEditor(draft, set);

  return (
    <SettingGroup title={t("launcher.window.title")} description={t("launcher.window.description")}>
      {WINDOW_PAIRS.map((pair) => {
        const label = actionLabel(pair.action);
        const combo = effectiveCombo(draft.hotkeys, pair.action);
        const taken = WINDOW_PAIRS.filter((p) => p.action !== pair.action).map((p) =>
          effectiveCombo(draft.hotkeys, p.action),
        );
        return (
          <SettingBlock
            key={pair.action}
            label={label}
            hint={t(`launcher.window.pairs.${pair.action}`)}
          >
            <div className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] items-center gap-4">
              <SettingSelect
                ariaLabel={t("launcher.window.modifierAria", { action: label })}
                value={combo}
                onValueChange={(v) => {
                  editor.onAssign(pair.action, v);
                }}
              >
                {PLATFORM_MODIFIERS.filter((m) => m === combo || !taken.includes(m)).map((m) => (
                  <SelectItem key={m} value={m}>
                    {t("launcher.window.modifierArrows", { combo: formatCombo(m) })}
                  </SelectItem>
                ))}
              </SettingSelect>
              <SettingSlider
                ariaLabel={t("launcher.window.stepAria", { action: label })}
                value={draft[pair.stepKey]}
                min={pair.limits.min}
                max={pair.limits.max}
                step={STEP_GRANULARITY}
                readout={`${String(draft[pair.stepKey])} px`}
                onChange={(v) => {
                  set(pair.stepKey, v);
                }}
              />
            </div>
          </SettingBlock>
        );
      })}
      <StolenNote editor={editor} />
    </SettingGroup>
  );
}
