import { describe, expect, it } from "vitest";
import { conflictsWithTyping, hotkeyFromEvent } from "./hotkey-capture";

const base = { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };

describe("hotkeyFromEvent", () => {
  it("одиночная буква", () => {
    expect(hotkeyFromEvent({ ...base, code: "KeyV" })).toBe("V");
  });
  it("F-клавиша", () => {
    expect(hotkeyFromEvent({ ...base, code: "F9" })).toBe("F9");
  });
  it("цифра с модификатором", () => {
    expect(hotkeyFromEvent({ ...base, ctrlKey: true, code: "Digit1" })).toBe("Ctrl+1");
  });
  it("комбо с несколькими модификаторами в фиксированном порядке", () => {
    expect(hotkeyFromEvent({ ...base, metaKey: true, shiftKey: true, code: "KeyR" })).toBe(
      "Cmd+Shift+R",
    );
    expect(
      hotkeyFromEvent({ metaKey: true, ctrlKey: true, altKey: true, shiftKey: true, code: "KeyA" }),
    ).toBe("Cmd+Ctrl+Alt+Shift+A");
  });
  it("на Windows клавиша Win не назначается — иначе биндинг мёртвый", () => {
    expect(hotkeyFromEvent({ ...base, metaKey: true, code: "KeyR" }, "windows")).toBeNull();
    expect(hotkeyFromEvent({ ...base, ctrlKey: true, code: "KeyR" }, "windows")).toBe("Ctrl+R");
    expect(hotkeyFromEvent({ ...base, metaKey: true, code: "KeyR" }, "macos")).toBe("Cmd+R");
  });
  it("только модификаторы → null", () => {
    expect(hotkeyFromEvent({ ...base, metaKey: true, code: "MetaLeft" })).toBeNull();
    expect(hotkeyFromEvent({ ...base, shiftKey: true, code: "ShiftLeft" })).toBeNull();
  });
  it("именованные клавиши и стрелки теперь назначаются", () => {
    expect(hotkeyFromEvent({ ...base, code: "Space" })).toBe("Space");
    expect(hotkeyFromEvent({ ...base, metaKey: true, code: "ArrowUp" })).toBe("Cmd+ArrowUp");
    expect(hotkeyFromEvent({ ...base, metaKey: true, shiftKey: true, code: "Minus" })).toBe(
      "Cmd+Shift+Minus",
    );
    expect(hotkeyFromEvent({ ...base, code: "BracketLeft" })).toBe("BracketLeft");
  });

  it("нераспознанный код → null", () => {
    expect(hotkeyFromEvent({ ...base, code: "AudioVolumeUp" })).toBeNull();
  });
});

describe("conflictsWithTyping", () => {
  it("модификаторы понимаются в любом написании", () => {
    expect(conflictsWithTyping("cmd+x")).toBe(false);
    expect(conflictsWithTyping("Meta+X")).toBe(false);
    expect(conflictsWithTyping("shift+x")).toBe(true);
  });

  it("одиночная буква/цифра мешает печати (в т.ч. с Shift)", () => {
    expect(conflictsWithTyping("V")).toBe(true);
    expect(conflictsWithTyping("1")).toBe(true);
    expect(conflictsWithTyping("Shift+V")).toBe(true);
  });
  it("F-клавиши и комбинации с Cmd/Ctrl/Alt печати не мешают", () => {
    expect(conflictsWithTyping("F9")).toBe(false);
    expect(conflictsWithTyping("F12")).toBe(false);
    expect(conflictsWithTyping("Cmd+V")).toBe(false);
    expect(conflictsWithTyping("Ctrl+1")).toBe(false);
    expect(conflictsWithTyping("Alt+R")).toBe(false);
    expect(conflictsWithTyping("Cmd+Shift+R")).toBe(false);
  });
});
