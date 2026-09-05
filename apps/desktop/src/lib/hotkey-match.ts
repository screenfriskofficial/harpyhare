import {
  ALT_MODIFIER,
  canonicalKey,
  CMD_MODIFIER,
  CTRL_MODIFIER,
  SHIFT_MODIFIER,
  splitCombo,
} from "./hotkeys";

export interface ModifierState {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export interface PreparedCombo {
  modifiers: ModifierState;
  key: string | null;
}

export interface KeyboardComboEvent extends ModifierState {
  code: string;
}

/**
 * Единственный разбор строки сочетания — `splitCombo`: он же понимает алиасы
 * (`cmd`/`meta`/`super`) и регистр так же, как Rust `split_combo`. Свой парсер
 * с точным сравнением `"Cmd"` молча не матчил бы `cmd+k`, который Rust принял.
 */
export function parseModifier(spec: string): ModifierState {
  const { modifiers } = splitCombo(spec);
  return {
    metaKey: modifiers.includes(CMD_MODIFIER),
    ctrlKey: modifiers.includes(CTRL_MODIFIER),
    altKey: modifiers.includes(ALT_MODIFIER),
    shiftKey: modifiers.includes(SHIFT_MODIFIER),
  };
}

/** Семейный хоткей («модификатор + стрелки/цифры/скобки»): пустая спека — не назначен. */
export function parseFamilyModifier(spec: string): ModifierState | null {
  return spec.trim() === "" ? null : parseModifier(spec);
}

export function matchesModifier(event: ModifierState, expected: ModifierState): boolean {
  return (
    event.metaKey === expected.metaKey &&
    event.ctrlKey === expected.ctrlKey &&
    event.altKey === expected.altKey &&
    event.shiftKey === expected.shiftKey
  );
}

export function prepareCombo(combo: string): PreparedCombo {
  const { key } = splitCombo(combo);
  return {
    modifiers: parseModifier(combo),
    key: key === null ? null : canonicalKey(key),
  };
}

export function matchesPrepared(event: KeyboardComboEvent, prepared: PreparedCombo): boolean {
  if (prepared.key === null) return false;
  if (canonicalKey(event.code) !== prepared.key) return false;
  return matchesModifier(event, prepared.modifiers);
}
