import {
  AppWindow,
  Keyboard,
  KeyRound,
  Mic,
  Palette,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { t } from "@/i18n";

/** Реестр без текста: подпись и описание таба переводятся по `id` (`launcher.tabs.*`). */
interface SettingsTabMeta {
  id: string;
  icon: LucideIcon;
}

/** Порядок — по частоте задач, а не по алфавиту: «Действия» раньше «Окна» намеренно. */
export const SETTINGS_TABS = [
  { id: "access", icon: KeyRound },
  { id: "speech", icon: Mic },
  { id: "hotkeys", icon: Keyboard },
  { id: "quick-actions", icon: Zap },
  { id: "window", icon: AppWindow },
  { id: "behavior", icon: Workflow },
  { id: "appearance", icon: Palette },
] as const satisfies readonly SettingsTabMeta[];

export type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"];

export const DEFAULT_SETTINGS_TAB: SettingsTabId = "access";

export function settingsTabLabel(id: SettingsTabId): string {
  return t(`launcher.tabs.${id}.label`);
}

export function settingsTabDescription(id: SettingsTabId): string {
  return t(`launcher.tabs.${id}.description`);
}
