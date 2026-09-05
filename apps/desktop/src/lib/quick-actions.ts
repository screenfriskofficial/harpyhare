import { QUICK_ACTION_LIMIT } from "@/ipc/bindings";
import type { QuickAction } from "@/ipc/types";
import { formatComboWithKey } from "./hotkeys";
import { PLATFORM, type Platform } from "./platform";

const FIRST_DIGIT = 1;
/** Ровно одна цифра из диапазона: `Number("1e0")` и `Number(" 1")` тоже дали бы 1. */
const QUICK_ACTION_DIGIT_RE = new RegExp(`^[${FIRST_DIGIT}-${QUICK_ACTION_LIMIT}]$`);

export function isQuickActionFilled(action: QuickAction): boolean {
  return action.title.trim() !== "" && action.prompt.trim() !== "";
}

export function filledQuickActions(actions: QuickAction[]): QuickAction[] {
  return actions.filter(isQuickActionFilled);
}

export function quickActionDigit(index: number): string | null {
  if (!Number.isInteger(index) || index < 0 || index >= QUICK_ACTION_LIMIT) return null;
  return String(index + FIRST_DIGIT);
}

export function isQuickActionDigit(key: string): boolean {
  return QUICK_ACTION_DIGIT_RE.test(key);
}

export function quickActionHint(
  combo: string,
  index: number,
  platform: Platform = PLATFORM,
): string | null {
  const digit = quickActionDigit(index);
  if (digit === null || combo.trim() === "") return null;
  return formatComboWithKey(combo, digit, platform);
}

export function newQuickAction(): QuickAction {
  return { id: crypto.randomUUID(), title: "", prompt: "" };
}
