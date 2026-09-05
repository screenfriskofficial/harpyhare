import { describe, expect, it } from "vitest";
import { HOTKEY_ACTIONS } from "@/ipc/bindings";
import type { HotkeyBinding } from "@/ipc/types";
import { comboTokens, defaultCombo, effectiveCombo, formatCombo, hotkeyGroups } from "./hotkeys";
import { PLATFORMS } from "./platform";

const NO_BINDINGS: HotkeyBinding[] = [];
const WINDOWS_KEY_TOKEN = "Cmd";

describe("formatCombo на macOS", () => {
  it("сворачивает модификаторы в mac-символы", () => {
    expect(formatCombo("Cmd+Shift+H", "macos")).toBe("⌘⇧H");
    expect(formatCombo("Ctrl+Alt+P", "macos")).toBe("⌃⌥P");
  });

  it("сворачивает спеку из одних модификаторов, без клавиши на конце", () => {
    expect(formatCombo("Cmd", "macos")).toBe("⌘");
    expect(formatCombo("Cmd+Shift", "macos")).toBe("⌘⇧");
  });

  it("именованные клавиши получают свои символы", () => {
    expect(formatCombo("Cmd+Enter", "macos")).toBe("⌘⏎");
    expect(formatCombo("Escape", "macos")).toBe("Esc");
    expect(formatCombo("Space", "macos")).toBe("␣");
    expect(formatCombo("Cmd+ArrowUp", "macos")).toBe("⌘↑");
    expect(formatCombo("Cmd+Minus", "macos")).toBe("⌘−");
  });

  it("длинная форма буквы читается как короткая", () => {
    expect(formatCombo("Cmd+KeyS", "macos")).toBe("⌘S");
    expect(formatCombo("Digit1", "macos")).toBe("1");
  });
});

describe("formatCombo для клавиш, которые принимает захват", () => {
  const ASSIGNABLE_NAMED_CODES = [
    "Home",
    "End",
    "Insert",
    "PageUp",
    "PageDown",
    "Numpad0",
    "Numpad7",
    "NumpadAdd",
    "NumpadSubtract",
    "NumpadMultiply",
    "NumpadDivide",
    "NumpadDecimal",
    "NumpadEnter",
  ];

  it.each(PLATFORMS)("ни один код не остаётся голым UPPERCASE (%s)", (platform) => {
    for (const code of ASSIGNABLE_NAMED_CODES) {
      const label = formatCombo(`Ctrl+${code}`, platform);
      expect(label).not.toContain(code.toUpperCase());
    }
  });

  it("цифровой блок подписан как Num …", () => {
    expect(formatCombo("Ctrl+NumpadAdd", "windows")).toBe("Ctrl+Num +");
    expect(formatCombo("Ctrl+Numpad7", "windows")).toBe("Ctrl+Num 7");
    expect(formatCombo("Ctrl+Home", "macos")).toBe("⌃Home");
    expect(formatCombo("Ctrl+Insert", "macos")).toBe("⌃Ins");
  });
});

describe("formatCombo на Windows", () => {
  it("модификаторы пишутся словами и разделяются плюсом", () => {
    expect(formatCombo("Ctrl+Shift+S", "windows")).toBe("Ctrl+Shift+S");
    expect(formatCombo("Ctrl+Alt+P", "windows")).toBe("Ctrl+Alt+P");
    expect(formatCombo("Cmd+Shift+H", "windows")).toBe("Win+Shift+H");
  });

  it("сворачивает спеку из одних модификаторов, без клавиши на конце", () => {
    expect(formatCombo("Ctrl", "windows")).toBe("Ctrl");
    expect(formatCombo("Ctrl+Shift", "windows")).toBe("Ctrl+Shift");
  });

  it("именованные клавиши получают свои символы", () => {
    expect(formatCombo("Ctrl+Enter", "windows")).toBe("Ctrl+⏎");
    expect(formatCombo("Escape", "windows")).toBe("Esc");
    expect(formatCombo("Space", "windows")).toBe("␣");
    expect(formatCombo("Ctrl+ArrowUp", "windows")).toBe("Ctrl+↑");
    expect(formatCombo("Ctrl+Minus", "windows")).toBe("Ctrl+−");
  });

  it("длинная форма буквы читается как короткая", () => {
    expect(formatCombo("Ctrl+KeyS", "windows")).toBe("Ctrl+S");
    expect(formatCombo("Digit1", "windows")).toBe("1");
  });
});

describe("defaultCombo", () => {
  it("отдаёт сочетание своей платформы", () => {
    expect(defaultCombo("toggle_window", "macos")).toBe("Cmd+Shift+H");
    expect(defaultCombo("toggle_window", "windows")).toBe("Ctrl+Shift+H");
    expect(defaultCombo("send", "macos")).toBe("Cmd+Enter");
    expect(defaultCombo("send", "windows")).toBe("Ctrl+Enter");
  });

  it("клавиши без платформенной разницы совпадают", () => {
    expect(defaultCombo("cancel_recording", "macos")).toBe(
      defaultCombo("cancel_recording", "windows"),
    );
    expect(defaultCombo("teleprompter_pause", "macos")).toBe(
      defaultCombo("teleprompter_pause", "windows"),
    );
  });

  it("PTT и суфлёр — на основном модификаторе платформы", () => {
    expect(defaultCombo("record", "macos")).toBe("Cmd+R");
    expect(defaultCombo("record", "windows")).toBe("Ctrl+R");
    expect(defaultCombo("teleprompter", "macos")).toBe("Cmd+T");
    expect(defaultCombo("teleprompter", "windows")).toBe("Ctrl+T");
  });

  it("на Windows ни один дефолт не занимает клавишу Win", () => {
    for (const action of HOTKEY_ACTIONS) {
      expect(defaultCombo(action.id, "windows")).not.toContain(WINDOWS_KEY_TOKEN);
    }
  });
});

describe.each(PLATFORMS)("effectiveCombo (%s)", (platform) => {
  it("без биндинга отдаёт дефолт действия своей платформы", () => {
    expect(effectiveCombo(NO_BINDINGS, "record", platform)).toBe(defaultCombo("record", platform));
    expect(effectiveCombo(NO_BINDINGS, "send", platform)).toBe(defaultCombo("send", platform));
  });

  it("биндинг перекрывает дефолт, пустая строка значит «не назначен»", () => {
    expect(effectiveCombo([{ action: "record", combo: "Cmd+Shift+X" }], "record", platform)).toBe(
      "Cmd+Shift+X",
    );
    expect(effectiveCombo([{ action: "record", combo: "" }], "record", platform)).toBe("");
  });
});

describe("hotkeyGroups на macOS", () => {
  it("собирает подсказки из реестра и текущих биндингов", () => {
    const combos = hotkeyGroups(NO_BINDINGS, "macos")
      .flatMap((g) => g.hints)
      .map((h) => h.combo);
    expect(combos).toContain("⌘R");
    expect(combos).toContain("⌘⇧H");
    expect(combos).toContain("⌘ ←→↑↓");
    expect(combos).toContain("⌘⇧ + −");
    expect(combos).toContain("⌘ 1…9");
    expect(combos).toContain("⌥ ←→↑↓");
    expect(combos).toContain("⌘V");
  });

  it("переназначенное действие показывается новым сочетанием", () => {
    const combos = hotkeyGroups([{ action: "record", combo: "Cmd+Shift+X" }], "macos")
      .flatMap((g) => g.hints)
      .map((h) => h.combo);
    expect(combos).toContain("⌘⇧X");
    expect(combos).not.toContain("⌘R");
  });
});

describe("hotkeyGroups на Windows", () => {
  it("собирает подсказки из реестра и текущих биндингов", () => {
    const combos = hotkeyGroups(NO_BINDINGS, "windows")
      .flatMap((g) => g.hints)
      .map((h) => h.combo);
    expect(combos).toContain("Ctrl+R");
    expect(combos).toContain("Ctrl+Shift+H");
    expect(combos).toContain("Ctrl ←→↑↓");
    expect(combos).toContain("Ctrl+Shift + −");
    expect(combos).toContain("Ctrl 1…9");
    expect(combos).toContain("Alt ←→↑↓");
    expect(combos).toContain("Ctrl+V");
  });

  it("mac-глифов в подсказках нет", () => {
    const combos = hotkeyGroups(NO_BINDINGS, "windows")
      .flatMap((g) => g.hints)
      .map((h) => h.combo)
      .join("");
    for (const glyph of ["⌘", "⇧", "⌥", "⌃"]) {
      expect(combos).not.toContain(glyph);
    }
  });
});

describe.each(PLATFORMS)("hotkeyGroups (%s)", (platform) => {
  it("не назначенное действие в справочник не попадает", () => {
    const labels = hotkeyGroups([{ action: "teleprompter", combo: "" }], platform)
      .flatMap((g) => g.hints)
      .map((h) => h.label);
    expect(labels).not.toContain("суфлёр");
  });

  it("каждая группа названа и непуста, подписи и комбо заполнены", () => {
    for (const group of hotkeyGroups(NO_BINDINGS, platform)) {
      expect(group.title).not.toBe("");
      expect(group.hints.length).toBeGreaterThan(0);
      for (const hint of group.hints) {
        expect(hint.combo).not.toBe("");
        expect(hint.label).not.toBe("");
      }
    }
  });
});

describe("comboTokens на macOS", () => {
  it("модификаторы разбираются в иконки", () => {
    expect(comboTokens("⌘⇧H", "macos")).toEqual([
      { type: "icon", icon: "cmd" },
      { type: "icon", icon: "shift" },
      { type: "text", text: "H" },
    ]);
  });

  it("текстовые клавиши склеиваются, пробелы выбрасываются", () => {
    expect(comboTokens("F9", "macos")).toEqual([{ type: "text", text: "F9" }]);
    expect(comboTokens("⌘⇧ + −", "macos")).toEqual([
      { type: "icon", icon: "cmd" },
      { type: "icon", icon: "shift" },
      { type: "icon", icon: "plus" },
      { type: "icon", icon: "minus" },
    ]);
  });

  it("подсказка с цифрами остаётся текстом", () => {
    expect(comboTokens("⌘ 1…9", "macos")).toEqual([
      { type: "icon", icon: "cmd" },
      { type: "text", text: "1…9" },
    ]);
  });
});

describe("comboTokens на Windows", () => {
  it("сочетание идёт одним текстовым токеном", () => {
    expect(comboTokens("Ctrl+Shift+S", "windows")).toEqual([
      { type: "text", text: "Ctrl+Shift+S" },
    ]);
  });

  it("плюс-разделитель не превращается в иконку, подсказка отделяется пробелом", () => {
    expect(comboTokens("Ctrl+Shift + −", "windows")).toEqual([
      { type: "text", text: "Ctrl+Shift" },
      { type: "text", text: "+" },
      { type: "text", text: "−" },
    ]);
  });

  it("стрелки и ввод остаются иконками", () => {
    expect(comboTokens("Ctrl ←→↑↓", "windows")).toEqual([
      { type: "text", text: "Ctrl" },
      { type: "icon", icon: "left" },
      { type: "icon", icon: "right" },
      { type: "icon", icon: "up" },
      { type: "icon", icon: "down" },
    ]);
    expect(comboTokens("Ctrl+⏎", "windows")).toEqual([
      { type: "text", text: "Ctrl+" },
      { type: "icon", icon: "enter" },
    ]);
  });
});
