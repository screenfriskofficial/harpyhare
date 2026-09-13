import {
  Download,
  Activity,
  Library,
  MessageSquareText,
  ShieldCheck,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import { PLATFORM, type Platform } from "@/lib/platform";

export const SCREEN_GROUPS = ["content", "system"] as const;

export type ScreenGroup = (typeof SCREEN_GROUPS)[number];

interface ScreenMeta {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  group: ScreenGroup;
  platforms?: readonly Platform[];
}

const MACOS_ONLY: readonly Platform[] = ["macos"];

export const LAUNCHER_SCREENS = [
  {
    id: "contexts",
    label: "Контексты",
    description: "Справочные материалы, которые можно подмешать в системный промпт чата.",
    icon: Library,
    group: "content",
  },
  {
    id: "presets",
    label: "Пресеты",
    description: "Препромпты: текст, который встаёт в начало системного промпта.",
    icon: MessageSquareText,
    group: "content",
  },
  {
    id: "settings",
    label: "Настройки",
    description: "Доступ к API, распознавание речи, клавиши, поведение и вид.",
    icon: SlidersHorizontal,
    group: "system",
  },
  {
    id: "permissions",
    label: "Доступы",
    description: "Системные разрешения, без которых часть приложения не работает.",
    icon: ShieldCheck,
    group: "system",
    platforms: MACOS_ONLY,
  },
  {
    id: "updates",
    label: "Обновления",
    description: "Версия приложения и установка новой.",
    icon: Download,
    group: "system",
  },
  {
    id: "diagnostics",
    label: "Диагностика",
    description: "История технических проверок без аудио, промптов и ключей.",
    icon: Activity,
    group: "system",
  },
] as const satisfies readonly ScreenMeta[];

export type ScreenId = (typeof LAUNCHER_SCREENS)[number]["id"];

export const DEFAULT_SCREEN: ScreenId = "settings";

function availableOn(screen: ScreenMeta, platform: Platform): boolean {
  return screen.platforms?.includes(platform) ?? true;
}

export function screenGroup(group: ScreenGroup, platform: Platform = PLATFORM) {
  return LAUNCHER_SCREENS.filter((s) => s.group === group && availableOn(s, platform));
}

export function screenMeta(id: ScreenId) {
  return LAUNCHER_SCREENS.find((s) => s.id === id) ?? LAUNCHER_SCREENS[0];
}
