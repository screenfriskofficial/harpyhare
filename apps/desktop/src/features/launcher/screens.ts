import {
  Activity,
  CircleCheck,
  Download,
  Library,
  MessageSquareText,
  ShieldCheck,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import { t } from "@/i18n";
import { PLATFORM, type Platform } from "@/lib/platform";

export const SCREEN_GROUPS = ["content", "system"] as const;

export type ScreenGroup = (typeof SCREEN_GROUPS)[number];

/** Реестр без текста: подпись и описание экрана переводятся по `id` (`launcher.screens.*`). */
interface ScreenMeta {
  id: string;
  icon: LucideIcon;
  group: ScreenGroup;
  platforms?: readonly Platform[];
}

const MACOS_ONLY: readonly Platform[] = ["macos"];

export const LAUNCHER_SCREENS = [
  { id: "check", icon: CircleCheck, group: "content" },
  { id: "contexts", icon: Library, group: "content" },
  { id: "presets", icon: MessageSquareText, group: "content" },
  { id: "settings", icon: SlidersHorizontal, group: "system" },
  { id: "diagnostics", icon: Activity, group: "system" },
  { id: "permissions", icon: ShieldCheck, group: "system", platforms: MACOS_ONLY },
  { id: "updates", icon: Download, group: "system" },
] as const satisfies readonly ScreenMeta[];

export type ScreenId = (typeof LAUNCHER_SCREENS)[number]["id"];

export function screenLabel(id: ScreenId): string {
  return t(`launcher.screens.${id}.label`);
}

export function screenDescription(id: ScreenId): string {
  return t(`launcher.screens.${id}.description`);
}

export const DEFAULT_SCREEN: ScreenId = "check";

function availableOn(screen: ScreenMeta, platform: Platform): boolean {
  return screen.platforms?.includes(platform) ?? true;
}

export function screenGroup(group: ScreenGroup, platform: Platform = PLATFORM) {
  return LAUNCHER_SCREENS.filter((s) => s.group === group && availableOn(s, platform));
}
