import { PREVIEW_PANEL_WIDTH_PX } from "@/components/PreviewPanel";

/** Геометрия оболочки HUD: от неё считаются и колонка чата, и целевой размер окна. */
export const SHELL_COLUMN_GAP_PX = 10;
export const SHELL_PADDING_PX = 12;
/** Окно с открытым превью шире базового ровно на панель и зазор колонок. */
export const PREVIEW_EXTRA_WIDTH_PX = PREVIEW_PANEL_WIDTH_PX + SHELL_COLUMN_GAP_PX;

export function chatColumnWidthPx(windowWidth: number): number {
  return windowWidth - SHELL_PADDING_PX * 2;
}
