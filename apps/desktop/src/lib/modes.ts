import { t } from "@/i18n";

const CHAT_MODE_ID = "chat";
const NOTES_MODE_ID = "notes";

/** Реестр режимов HUD без текста: подпись и подсказка берутся из словаря по `id`. */
export const APP_MODES = [{ id: CHAT_MODE_ID }, { id: NOTES_MODE_ID }] as const;

export type AppModeEntry = (typeof APP_MODES)[number];
export type AppModeId = AppModeEntry["id"];

export const DEFAULT_MODE: AppModeId = CHAT_MODE_ID;
export const NOTES_MODE: AppModeId = NOTES_MODE_ID;

export function modeLabel(id: AppModeId): string {
  return t(`modes.${id}.label`);
}

export function modeHint(id: AppModeId): string {
  return t(`modes.${id}.hint`);
}

export function nextMode(current: AppModeId): AppModeId {
  const index = APP_MODES.findIndex((mode) => mode.id === current);
  return (APP_MODES[(index + 1) % APP_MODES.length] ?? APP_MODES[0]).id;
}
