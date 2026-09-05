import { SETTINGS_LIMITS } from "@/ipc/bindings";

/** Границы — из реестра лимитов Rust (`settings::limits`), а не своя копия. */
export const TELEPROMPTER_SPEED_MIN = SETTINGS_LIMITS.teleprompterSpeed.min;
export const TELEPROMPTER_SPEED_MAX = SETTINGS_LIMITS.teleprompterSpeed.max;
export const TELEPROMPTER_SPEED_STEP = 5;
export const TELEPROMPTER_FONT_MIN = SETTINGS_LIMITS.teleprompterFontSize.min;
export const TELEPROMPTER_FONT_MAX = SETTINGS_LIMITS.teleprompterFontSize.max;
export const TELEPROMPTER_FONT_STEP = 2;

const MILLIS_PER_SECOND = 1000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampSpeed(value: number): number {
  return clamp(value, TELEPROMPTER_SPEED_MIN, TELEPROMPTER_SPEED_MAX);
}

export function clampFont(value: number): number {
  return clamp(value, TELEPROMPTER_FONT_MIN, TELEPROMPTER_FONT_MAX);
}

export function advanceOffset(
  offset: number,
  speedPxPerSecond: number,
  elapsedMs: number,
  maxOffset: number,
): number {
  const advanced = offset + (speedPxPerSecond * elapsedMs) / MILLIS_PER_SECOND;
  return clamp(advanced, 0, Math.max(0, maxOffset));
}

const FENCE_LINE = /^ {0,3}(?:`{3,}|~{3,})[^\n]*\n?/gm;
const INLINE_CODE = /`([^`]+)`/g;
const IMAGE = /!\[[^\]]*\]\([^)]*\)/g;
const LINK = /\[([^\]]+)\]\([^)]*\)/g;
const HEADING = /^[ \t]{0,3}#{1,6}[ \t]+/gm;
const BLOCKQUOTE = /^[ \t]{0,3}>[ \t]?/gm;
/** Горизонтальная линия и строка-разделитель таблицы: читать вслух там нечего. */
const HORIZONTAL_RULE = /^[ \t]{0,3}(?:[-*_][ \t]*){3,}$\n?/gm;
const TABLE_SEPARATOR_ROW = /^[ \t]*\|?(?:[ \t]*:?-+:?[ \t]*\|)+[ \t]*:?-*:?[ \t]*$\n?/gm;
const TABLE_EDGE_PIPE = /^[ \t]*\|[ \t]*|[ \t]*\|[ \t]*$/gm;
const TABLE_CELL_PIPE = /[ \t]*\|[ \t]*/g;
const TABLE_CELL_SEPARATOR = ", ";
const BULLET = /^[ \t]*[-*+][ \t]+/gm;
const ORDERED = /^[ \t]*\d+\.[ \t]+/gm;
/**
 * Выделение — только с непробельным символом у обеих границ: `2 * 3 * 4` —
 * умножение, а не курсив (иначе суфлёр читал бы «2 3 4»). Вложенное выделение
 * снимается повторными проходами до схождения: `**b *c* d**` → `b c d`.
 */
const BOLD = /\*\*([^\s*](?:[^*]*[^\s*])?)\*\*/g;
const ITALIC = /\*([^\s*](?:[^*]*[^\s*])?)\*/g;
const BOLD_UNDERSCORE = /__([^_]+)__/g;
const ITALIC_UNDERSCORE = /(?<![A-Za-zА-Яа-я0-9])_([^_]+)_(?![A-Za-zА-Яа-я0-9])/g;
const STRIKETHROUGH = /~~([^~]+)~~/g;
const EXTRA_BLANK_LINES = /\n{3,}/g;
const EMPHASIS_PASSES_MAX = 4;

function stripEmphasis(text: string): string {
  let current = text;
  for (let pass = 0; pass < EMPHASIS_PASSES_MAX; pass += 1) {
    const next = current
      .replace(BOLD, "$1")
      .replace(BOLD_UNDERSCORE, "$1")
      .replace(ITALIC, "$1")
      .replace(ITALIC_UNDERSCORE, "$1")
      .replace(STRIKETHROUGH, "$1");
    if (next === current) return current;
    current = next;
  }
  return current;
}

function stripTables(text: string): string {
  return text
    .replace(TABLE_SEPARATOR_ROW, "")
    .replace(TABLE_EDGE_PIPE, "")
    .replace(TABLE_CELL_PIPE, TABLE_CELL_SEPARATOR);
}

export function toReadingText(markdown: string): string {
  const blocksStripped = markdown
    .replace(FENCE_LINE, "")
    .replace(IMAGE, "")
    .replace(LINK, "$1")
    .replace(INLINE_CODE, "$1")
    .replace(HEADING, "")
    .replace(BLOCKQUOTE, "")
    .replace(HORIZONTAL_RULE, "")
    .replace(BULLET, "")
    .replace(ORDERED, "");
  return stripEmphasis(stripTables(blocksStripped)).replace(EXTRA_BLANK_LINES, "\n\n").trim();
}
