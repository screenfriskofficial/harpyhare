import { describe, expect, it } from "vitest";
import { QUICK_ACTION_LIMIT } from "@/ipc/bindings";
import type { QuickAction } from "@/ipc/types";
import {
  filledQuickActions,
  isQuickActionDigit,
  isQuickActionFilled,
  newQuickAction,
  quickActionDigit,
  quickActionHint,
} from "./quick-actions";

function action(title: string, prompt: string): QuickAction {
  return { ...newQuickAction(), title, prompt };
}

const FILLED = action("Перевести", "Переведи на английский");

describe("isQuickActionFilled", () => {
  it("заполнено, когда есть и заголовок, и промпт", () => {
    expect(isQuickActionFilled(FILLED)).toBe(true);
  });

  it("полупустое действие не считается заполненным", () => {
    expect(isQuickActionFilled(action("Перевести", ""))).toBe(false);
    expect(isQuickActionFilled(action("", "Переведи на английский"))).toBe(false);
  });

  it("пробелы не считаются содержимым", () => {
    expect(isQuickActionFilled(action("   ", "\n\t"))).toBe(false);
    expect(isQuickActionFilled(action(" ", FILLED.prompt))).toBe(false);
  });
});

describe("filledQuickActions", () => {
  it("оставляет только заполненные, сохраняя порядок", () => {
    const second = action("Кратко", "Сократи до трёх пунктов");
    const list = [FILLED, action("", ""), second, action("Без промпта", "")];
    expect(filledQuickActions(list)).toEqual([FILLED, second]);
  });

  it("пустой список остаётся пустым", () => {
    expect(filledQuickActions([])).toEqual([]);
  });
});

describe("quickActionDigit", () => {
  it("нумерует с единицы", () => {
    expect(quickActionDigit(0)).toBe("1");
    expect(quickActionDigit(QUICK_ACTION_LIMIT - 1)).toBe(String(QUICK_ACTION_LIMIT));
  });

  it("за пределом лимита цифры нет", () => {
    expect(quickActionDigit(QUICK_ACTION_LIMIT)).toBeNull();
    expect(quickActionDigit(-1)).toBeNull();
  });

  it("каждая цифра в пределах лимита уникальна и односимвольна", () => {
    const digits = Array.from({ length: QUICK_ACTION_LIMIT }, (_, i) => quickActionDigit(i));
    expect(digits.every((d) => d !== null && d.length === 1)).toBe(true);
    expect(new Set(digits).size).toBe(QUICK_ACTION_LIMIT);
  });
});

describe("newQuickAction", () => {
  it("пустое действие с уникальным id", () => {
    const first = newQuickAction();
    const second = newQuickAction();
    expect(first.title).toBe("");
    expect(first.prompt).toBe("");
    expect(first.id).not.toBe("");
    expect(first.id).not.toBe(second.id);
  });

  it("новое действие не заполнено", () => {
    expect(isQuickActionFilled(newQuickAction())).toBe(false);
  });
});

describe("isQuickActionDigit", () => {
  it("узнаёт только цифры в пределах ряда быстрых действий", () => {
    expect(isQuickActionDigit("1")).toBe(true);
    expect(isQuickActionDigit(String(QUICK_ACTION_LIMIT))).toBe(true);
    expect(isQuickActionDigit("0")).toBe(false);
    expect(isQuickActionDigit(String(QUICK_ACTION_LIMIT + 1))).toBe(false);
  });

  it("не принимает буквы и пустую строку", () => {
    expect(isQuickActionDigit("A")).toBe(false);
    expect(isQuickActionDigit("")).toBe(false);
    expect(isQuickActionDigit("ARROWUP")).toBe(false);
    expect(isQuickActionDigit("1e0")).toBe(false);
    expect(isQuickActionDigit(" 1")).toBe(false);
  });
});

describe("quickActionHint", () => {
  it("склеивает модификатор с цифрой позиции по правилам платформы", () => {
    expect(quickActionHint("Cmd", 0, "macos")).toBe("⌘1");
    expect(quickActionHint("Cmd", 1, "macos")).toBe("⌘2");
    expect(quickActionHint("Ctrl", 0, "windows")).toBe("Ctrl+1");
  });

  it("без сочетания и за пределом ряда подсказки нет", () => {
    expect(quickActionHint("", 0, "macos")).toBeNull();
    expect(quickActionHint("Cmd", QUICK_ACTION_LIMIT, "macos")).toBeNull();
  });
});
