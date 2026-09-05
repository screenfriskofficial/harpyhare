import { SETTINGS_LIMITS } from "@/ipc/bindings";

const NON_DRAGGABLE_SELECTOR = "button, a, input, textarea, select, [role='tab'], [data-no-drag]";
const OPACITY_CSS_VAR = "--app-opacity";
/** Границы — из реестра лимитов Rust (`settings::limits`), а не своя копия. */
const OPACITY_MIN = SETTINGS_LIMITS.windowOpacity.min;
const OPACITY_MAX = SETTINGS_LIMITS.windowOpacity.max;
const CHAT_FONT_SIZE_CSS_VAR = "--chat-font-size";
const CHAT_FONT_SIZE_MIN_PX = SETTINGS_LIMITS.chatFontSize.min;
const CHAT_FONT_SIZE_MAX_PX = SETTINGS_LIMITS.chatFontSize.max;
const HUNDREDTHS = 100;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundToHundredths(value: number): number {
  return Math.round(value * HUNDREDTHS) / HUNDREDTHS;
}

export function isDraggableChromeTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest(NON_DRAGGABLE_SELECTOR) === null;
}

export function applyOpacity(root: HTMLElement, value: number): void {
  if (!Number.isFinite(value)) return;
  const clamped = clamp(value, OPACITY_MIN, OPACITY_MAX);
  root.style.setProperty(OPACITY_CSS_VAR, String(clamped));
}

export function stepOpacity(current: number, dir: 1 | -1, step: number): number {
  return clamp(roundToHundredths(current + dir * step), OPACITY_MIN, OPACITY_MAX);
}

export function applyChatFontSize(root: HTMLElement, px: number): void {
  if (!Number.isFinite(px)) return;
  const clamped = clamp(px, CHAT_FONT_SIZE_MIN_PX, CHAT_FONT_SIZE_MAX_PX);
  root.style.setProperty(CHAT_FONT_SIZE_CSS_VAR, `${String(clamped)}px`);
}

/** Шаг слайдера в лаунчере мельче: там подбирают точно, хоткеем — на ходу. */
export const CHAT_FONT_SIZE_HOTKEY_STEP_PX = 1;

export function stepChatFontSize(current: number, dir: 1 | -1, step: number): number {
  return clamp(current + dir * step, CHAT_FONT_SIZE_MIN_PX, CHAT_FONT_SIZE_MAX_PX);
}

const THEME_DATA_ATTR = "data-theme";
export const THEME_GRAY = "gray";
export const THEME_BLACK = "black";

export function applyTheme(root: HTMLElement, theme: string): void {
  root.setAttribute(THEME_DATA_ATTR, theme === THEME_BLACK ? THEME_BLACK : THEME_GRAY);
}
