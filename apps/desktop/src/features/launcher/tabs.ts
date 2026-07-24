import {
  Keyboard,
  KeyRound,
  Library,
  MessageSquareText,
  Palette,
  Puzzle,
  SlidersHorizontal,
  VenetianMask,
  type LucideIcon,
} from "lucide-react";

export const LAUNCHER_TABS = [
  { id: "main", label: "Основное", icon: KeyRound },
  { id: "contexts", label: "Контексты", icon: Library },
  { id: "hotkeys", label: "Горячие клавиши", icon: Keyboard },
  { id: "behavior", label: "Поведение", icon: SlidersHorizontal },
  { id: "appearance", label: "Вид", icon: Palette },
  { id: "identity", label: "Маскировка", icon: VenetianMask },
  { id: "presets", label: "Пресеты", icon: MessageSquareText },
  { id: "plugins", label: "Плагины", icon: Puzzle },
] as const satisfies readonly { id: string; label: string; icon: LucideIcon }[];

export type TabId = (typeof LAUNCHER_TABS)[number]["id"];
