import { t } from "@/i18n";
import { HOTKEY_ACTIONS, QUICK_ACTION_LIMIT } from "@/ipc/bindings";
import type { HotkeyBinding } from "@/ipc/types";
import { PLATFORM, type Platform } from "./platform";

export type HotkeyAction = (typeof HOTKEY_ACTIONS)[number];
export type HotkeyActionId = HotkeyAction["id"];
export type HotkeyGroupId = HotkeyAction["group"];

/**
 * Подписи действий живут в словаре по `id`, а не в реестре Rust: реестр несёт
 * русский `label`/`hint` только для собственных сообщений бэкенда, и тест
 * `i18n.test.ts` держит русский словарь дословно равным ему.
 */
export function actionLabel(id: HotkeyActionId): string {
  return t(`hotkeys.actions.${id}.label`);
}

export function actionHint(id: HotkeyActionId): string {
  return t(`hotkeys.actions.${id}.hint`);
}

export function groupTitle(group: HotkeyGroupId): string {
  return t(`hotkeys.groups.${group}`);
}

/**
 * Строковый формат сочетания общий с Rust (`parse_hotkey`/`split_combo`):
 * токены через `+`, модификаторы в канонической записи ниже, алиасы и регистр
 * прощаются на разборе. Разделитель и канонические имена объявлены один раз —
 * `hotkey-capture` их пишет, `hotkey-match` читает.
 */
export const COMBO_SEPARATOR = "+";
export const CMD_MODIFIER = "Cmd";
export const CTRL_MODIFIER = "Ctrl";
export const ALT_MODIFIER = "Alt";
export const SHIFT_MODIFIER = "Shift";

const MODIFIER_ALIASES: Record<string, string> = {
  cmd: CMD_MODIFIER,
  command: CMD_MODIFIER,
  super: CMD_MODIFIER,
  meta: CMD_MODIFIER,
  ctrl: CTRL_MODIFIER,
  control: CTRL_MODIFIER,
  alt: ALT_MODIFIER,
  option: ALT_MODIFIER,
  shift: SHIFT_MODIFIER,
};

const MODIFIER_LABELS: Record<Platform, Record<string, string>> = {
  macos: {
    [CMD_MODIFIER]: "⌘",
    [SHIFT_MODIFIER]: "⇧",
    [ALT_MODIFIER]: "⌥",
    [CTRL_MODIFIER]: "⌃",
  },
  windows: {
    [CMD_MODIFIER]: "Win",
    [SHIFT_MODIFIER]: "Shift",
    [ALT_MODIFIER]: "Alt",
    [CTRL_MODIFIER]: "Ctrl",
  },
};

const TOKEN_JOINER: Record<Platform, string> = {
  macos: "",
  windows: COMBO_SEPARATOR,
};

const KEY_SYMBOLS: Record<string, string> = {
  ENTER: "⏎",
  ESCAPE: "Esc",
  SPACE: "␣",
  TAB: "⇥",
  BACKSPACE: "⌫",
  DELETE: "⌦",
  ARROWUP: "↑",
  ARROWDOWN: "↓",
  ARROWLEFT: "←",
  ARROWRIGHT: "→",
  MINUS: "−",
  EQUAL: "+",
  COMMA: ",",
  PERIOD: ".",
  SLASH: "/",
  BACKSLASH: "\\",
  SEMICOLON: ";",
  QUOTE: "'",
  BACKQUOTE: "`",
  BRACKETLEFT: "[",
  BRACKETRIGHT: "]",
  PAGEUP: "PgUp",
  PAGEDOWN: "PgDn",
  HOME: "Home",
  END: "End",
  INSERT: "Ins",
};

/** Клавиши цифрового блока подписываются «Num …», чтобы не путаться с основными. */
const NUMPAD_CODE_PREFIX = "NUMPAD";
const NUMPAD_LABEL_PREFIX = "Num";
const NUMPAD_KEY_SYMBOLS: Record<string, string> = {
  ADD: "+",
  SUBTRACT: "−",
  MULTIPLY: "*",
  DIVIDE: "/",
  DECIMAL: ".",
  ENTER: "⏎",
};

const HINT_SEPARATOR = " ";
const ARROWS_HINT = "←→↑↓";
const PLUS_MINUS_HINT = "+ −";
const BRACKETS_HINT = "[ ]";
const DIGITS_HINT = `1…${QUICK_ACTION_LIMIT}`;

const KIND_HINTS: Partial<Record<HotkeyAction["kind"], string>> = {
  modifier_arrows: ARROWS_HINT,
  modifier_plus_minus: PLUS_MINUS_HINT,
  modifier_brackets: BRACKETS_HINT,
  modifier_digits: DIGITS_HINT,
};

export function hotkeyAction(id: HotkeyActionId): HotkeyAction {
  return HOTKEY_ACTIONS.find((a) => a.id === id) ?? HOTKEY_ACTIONS[0];
}

export function defaultCombo(id: HotkeyActionId, platform: Platform = PLATFORM): string {
  return hotkeyAction(id).defaultCombo[platform];
}

export function effectiveCombo(
  bindings: HotkeyBinding[],
  id: HotkeyActionId,
  platform: Platform = PLATFORM,
): string {
  for (let i = bindings.length - 1; i >= 0; i--) {
    const bound = bindings[i];
    if (bound?.action === id) return bound.combo;
  }
  return defaultCombo(id, platform);
}

export function splitCombo(combo: string): { modifiers: string[]; key: string | null } {
  const modifiers: string[] = [];
  let key: string | null = null;
  for (const raw of combo.split(COMBO_SEPARATOR)) {
    const token = raw.trim();
    if (token === "") continue;
    const canonical = MODIFIER_ALIASES[token.toLowerCase()];
    if (canonical === undefined) key = token;
    else if (!modifiers.includes(canonical)) modifiers.push(canonical);
  }
  return { modifiers, key };
}

export function sortedModifiers(combo: string): string[] {
  return [...splitCombo(combo).modifiers].sort();
}

export function canonicalKey(token: string): string {
  const upper = token.trim().toUpperCase();
  for (const prefix of ["KEY", "DIGIT"]) {
    if (upper.startsWith(prefix) && upper.length === prefix.length + 1) {
      return upper.slice(prefix.length);
    }
  }
  return upper;
}

function formatKey(token: string): string {
  const canonical = canonicalKey(token);
  if (canonical.startsWith(NUMPAD_CODE_PREFIX)) {
    const rest = canonical.slice(NUMPAD_CODE_PREFIX.length);
    return [NUMPAD_LABEL_PREFIX, NUMPAD_KEY_SYMBOLS[rest] ?? rest].join(HINT_SEPARATOR);
  }
  return KEY_SYMBOLS[canonical] ?? canonical;
}

export function formatCombo(combo: string, platform: Platform = PLATFORM): string {
  const { modifiers, key } = splitCombo(combo);
  const labels = MODIFIER_LABELS[platform];
  const parts = modifiers.map((m) => labels[m] ?? m);
  if (key !== null) parts.push(formatKey(key));
  return parts.join(TOKEN_JOINER[platform]);
}

export function formatComboWithKey(
  combo: string,
  key: string,
  platform: Platform = PLATFORM,
): string {
  return formatCombo([combo, key].join(COMBO_SEPARATOR), platform);
}

export function comboLabel(
  action: HotkeyAction,
  combo: string,
  platform: Platform = PLATFORM,
): string {
  if (combo.trim() === "") return "";
  const formatted = formatCombo(combo, platform);
  const hint = KIND_HINTS[action.kind];
  return hint === undefined ? formatted : `${formatted}${HINT_SEPARATOR}${hint}`;
}

export interface HotkeyHint {
  combo: string;
  label: string;
}

export interface HotkeyGroup {
  title: string;
  hints: HotkeyHint[];
}

const PASTE_MODIFIER: Record<Platform, string> = {
  macos: CMD_MODIFIER,
  windows: CTRL_MODIFIER,
};
const SEND_KEY = "Enter";
const PASTE_KEY = "V";
const ESCAPE_KEY = "Escape";
const ARROW_UP_KEY = "ArrowUp";
const ARROW_DOWN_KEY = "ArrowDown";
const FIELD_HINTS_GROUP = hotkeyAction("send").group;
const NOTES_HINTS_GROUP = hotkeyAction("toggle_mode").group;

function fieldHints(platform: Platform): Partial<Record<HotkeyGroupId, HotkeyHint[]>> {
  const paste = [PASTE_MODIFIER[platform], PASTE_KEY].join(COMBO_SEPARATOR);
  const newline = [SHIFT_MODIFIER, SEND_KEY].join(COMBO_SEPARATOR);
  const upDown = [ARROW_UP_KEY, ARROW_DOWN_KEY].map((key) => formatCombo(key, platform)).join("");
  return {
    [FIELD_HINTS_GROUP]: [
      { combo: formatCombo(SEND_KEY, platform), label: t("hotkeys.fieldHints.sendFromField") },
      { combo: formatCombo(newline, platform), label: t("hotkeys.fieldHints.newline") },
      { combo: formatCombo(paste, platform), label: t("hotkeys.fieldHints.pasteScreenshot") },
    ],
    [NOTES_HINTS_GROUP]: [
      { combo: upDown, label: t("hotkeys.fieldHints.browseSuggestions") },
      { combo: formatCombo(SEND_KEY, platform), label: t("hotkeys.fieldHints.openNote") },
      { combo: formatCombo(ESCAPE_KEY, platform), label: t("hotkeys.fieldHints.stepBack") },
    ],
  };
}

export function hotkeyGroups(
  bindings: HotkeyBinding[],
  platform: Platform = PLATFORM,
): HotkeyGroup[] {
  const byGroup = new Map<HotkeyGroupId, HotkeyGroup>();
  for (const action of HOTKEY_ACTIONS) {
    const combo = comboLabel(action, effectiveCombo(bindings, action.id, platform), platform);
    if (combo === "") continue;
    const hint = { combo, label: actionLabel(action.id).toLocaleLowerCase() };
    const existing = byGroup.get(action.group);
    if (existing) existing.hints.push(hint);
    else byGroup.set(action.group, { title: groupTitle(action.group), hints: [hint] });
  }
  const hints = fieldHints(platform);
  for (const [group, entry] of byGroup) {
    entry.hints.push(...(hints[group] ?? []));
  }
  return [...byGroup.values()];
}

export type ComboIconName =
  | "cmd"
  | "shift"
  | "option"
  | "ctrl"
  | "enter"
  | "up"
  | "down"
  | "left"
  | "right"
  | "plus"
  | "minus";

export type ComboToken = { type: "icon"; icon: ComboIconName } | { type: "text"; text: string };

const KEY_GLYPH_ICONS: Record<string, ComboIconName> = {
  "⏎": "enter",
  "↑": "up",
  "↓": "down",
  "←": "left",
  "→": "right",
};

const MACOS_GLYPH_ICONS: Record<string, ComboIconName> = {
  "⌘": "cmd",
  "⇧": "shift",
  "⌥": "option",
  "⌃": "ctrl",
  "+": "plus",
  "−": "minus",
};

const ICON_BY_CHAR: Record<Platform, Record<string, ComboIconName>> = {
  macos: { ...MACOS_GLYPH_ICONS, ...KEY_GLYPH_ICONS },
  windows: KEY_GLYPH_ICONS,
};

export function comboTokens(combo: string, platform: Platform = PLATFORM): ComboToken[] {
  const icons = ICON_BY_CHAR[platform];
  const tokens: ComboToken[] = [];
  let openText = false;
  for (const ch of combo) {
    if (ch === HINT_SEPARATOR) {
      openText = false;
      continue;
    }
    const icon = icons[ch];
    if (icon) {
      tokens.push({ type: "icon", icon });
      openText = false;
      continue;
    }
    const last = tokens[tokens.length - 1];
    if (openText && last?.type === "text") last.text += ch;
    else {
      tokens.push({ type: "text", text: ch });
      openText = true;
    }
  }
  return tokens;
}
