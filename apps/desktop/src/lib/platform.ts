import { t } from "@/i18n";

export const PLATFORMS = ["macos", "windows"] as const;

export type Platform = (typeof PLATFORMS)[number];

const DEFAULT_PLATFORM: Platform = "macos";
const WINDOWS_USER_AGENT_MARKER = "windows";

/** «из Finder» / «из проводника» — имя файлового менеджера платформы в подсказках импорта. */
export function fileManagerLabel(platform: Platform = PLATFORM): string {
  return t(`platform.fileManager.${platform}`);
}

export function detectPlatform(userAgent: string): Platform {
  return userAgent.toLowerCase().includes(WINDOWS_USER_AGENT_MARKER) ? "windows" : DEFAULT_PLATFORM;
}

export const PLATFORM: Platform = detectPlatform(navigator.userAgent);
