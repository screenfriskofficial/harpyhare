import { SETTINGS_LIMITS } from "@/ipc/bindings";

/** Геометрия оболочки HUD: от неё считаются и колонка чата, и целевой размер окна. */
export const SHELL_COLUMN_GAP_PX = 10;
export const SHELL_PADDING_PX = 12;
/** Gap between the chat ledger and the composer slot; the card's overhang eats it first, then the ledger. */
export const CHAT_COLUMN_GAP_PX = 10;
const PREVIEW_WIDTH = SETTINGS_LIMITS.previewWidth;
/**
 * A window with the preview open is wider than the base by exactly a panel of
 * DEFAULT width plus the column gap. The panel itself may be wider or narrower
 * — its edge is dragged with the mouse — but the chat column gives or takes the
 * difference and the window is left alone: otherwise every drag would resize
 * the window, whose size the user sets.
 */
export const PREVIEW_EXTRA_WIDTH_PX = PREVIEW_WIDTH.default + SHELL_COLUMN_GAP_PX;
/** The chat column is never narrower than in the narrowest window without a preview. */
const CHAT_COLUMN_MIN_PX = SETTINGS_LIMITS.windowWidth.min - SHELL_PADDING_PX * 2;

export interface PreviewWidthBounds {
  min: number;
  max: number;
}

/** Preview width bounds in this window: the shared ones from Rust, capped by what is left for the chat. */
export function previewWidthBounds(windowWidth: number): PreviewWidthBounds {
  const room = windowWidth - SHELL_PADDING_PX * 2 + PREVIEW_WIDTH.default - CHAT_COLUMN_MIN_PX;
  return {
    min: PREVIEW_WIDTH.min,
    max: Math.max(PREVIEW_WIDTH.min, Math.min(PREVIEW_WIDTH.max, room)),
  };
}

export function clampPreviewWidth(width: number, windowWidth: number): number {
  const { min, max } = previewWidthBounds(windowWidth);
  const wanted = Number.isFinite(width) ? width : PREVIEW_WIDTH.default;
  return Math.round(Math.min(max, Math.max(min, wanted)));
}

/**
 * The chat column is the whole window minus padding; with the preview open it
 * gives the panel whatever the panel is wider than the default (or takes it
 * back when the panel is narrower).
 */
export function chatColumnWidthPx(windowWidth: number, previewWidth: number | null): number {
  const base = windowWidth - SHELL_PADDING_PX * 2;
  return previewWidth === null ? base : base + PREVIEW_WIDTH.default - previewWidth;
}
