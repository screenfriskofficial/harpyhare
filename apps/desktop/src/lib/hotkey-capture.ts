import {
  ALT_MODIFIER,
  CMD_MODIFIER,
  COMBO_SEPARATOR,
  CTRL_MODIFIER,
  SHIFT_MODIFIER,
  splitCombo,
} from "./hotkeys";
import { PLATFORM, type Platform } from "./platform";

export interface HotkeyEvent {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  code: string;
}

const PLATFORMS_WITH_ASSIGNABLE_META: readonly Platform[] = ["macos"];
const LETTER_CODE_RE = /^Key([A-Z])$/;
const FUNCTION_KEY_CODE_RE = /^F(?:[1-9]|1[0-9]|2[0-4])$/;
const DIGIT_CODE_RE = /^Digit([0-9])$/;
const NUMPAD_CODE_RE = /^Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter)$/;
const SINGLE_LETTER_OR_DIGIT_RE = /^[a-z0-9]$/i;

const NAMED_CODES = new Set([
  "Escape",
  "Enter",
  "Space",
  "Tab",
  "Backspace",
  "Delete",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Insert",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Minus",
  "Equal",
  "BracketLeft",
  "BracketRight",
  "Backslash",
  "Semicolon",
  "Quote",
  "Backquote",
  "Comma",
  "Period",
  "Slash",
]);

const MODIFIER_ONLY_CODES = new Set([
  "MetaLeft",
  "MetaRight",
  "ShiftLeft",
  "ShiftRight",
  "AltLeft",
  "AltRight",
  "ControlLeft",
  "ControlRight",
  "CapsLock",
]);

export function isModifierOnlyCode(code: string): boolean {
  return MODIFIER_ONLY_CODES.has(code);
}

function mainKeyToken(code: string): string | null {
  const letter = LETTER_CODE_RE.exec(code)?.[1];
  if (letter !== undefined) return letter;
  if (FUNCTION_KEY_CODE_RE.test(code)) return code;
  const digit = DIGIT_CODE_RE.exec(code)?.[1];
  if (digit !== undefined) return digit;
  if (NAMED_CODES.has(code) || NUMPAD_CODE_RE.test(code)) return code;
  return null;
}

/** Shift — единственный модификатор, который при печати и так зажат: он от конфликта не спасает. */
export function conflictsWithTyping(hotkey: string): boolean {
  const { modifiers, key } = splitCombo(hotkey);
  if (modifiers.some((m) => m !== SHIFT_MODIFIER)) return false;
  return SINGLE_LETTER_OR_DIGIT_RE.test(key ?? "");
}

export function hotkeyFromEvent(e: HotkeyEvent, platform: Platform = PLATFORM): string | null {
  const key = mainKeyToken(e.code);
  if (key === null) return null;
  if (e.metaKey && !PLATFORMS_WITH_ASSIGNABLE_META.includes(platform)) return null;
  const mods: string[] = [];
  if (e.metaKey) mods.push(CMD_MODIFIER);
  if (e.ctrlKey) mods.push(CTRL_MODIFIER);
  if (e.altKey) mods.push(ALT_MODIFIER);
  if (e.shiftKey) mods.push(SHIFT_MODIFIER);
  return [...mods, key].join(COMBO_SEPARATOR);
}
