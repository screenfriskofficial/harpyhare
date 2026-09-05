import { describe, expect, it } from "vitest";
import { MODIFIER_COMBOS } from "@/ipc/bindings";
import {
  matchesModifier,
  matchesPrepared,
  parseFamilyModifier,
  parseModifier,
  prepareCombo,
  type ModifierState,
} from "./hotkey-match";
import { PLATFORMS } from "./platform";

const NONE: ModifierState = {
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
};

describe("matchesModifier", () => {
  it("matches a single modifier exactly", () => {
    expect(matchesModifier({ ...NONE, metaKey: true }, parseModifier("Cmd"))).toBe(true);
    expect(matchesModifier({ ...NONE, altKey: true }, parseModifier("Alt"))).toBe(true);
  });

  it("requires an exact set — extra modifier fails", () => {
    expect(matchesModifier({ ...NONE, metaKey: true, shiftKey: true }, parseModifier("Cmd"))).toBe(
      false,
    );
  });

  it("matches a combo and rejects a partial press", () => {
    expect(
      matchesModifier({ ...NONE, metaKey: true, shiftKey: true }, parseModifier("Cmd+Shift")),
    ).toBe(true);
    expect(matchesModifier({ ...NONE, metaKey: true }, parseModifier("Cmd+Shift"))).toBe(false);
  });

  it("rejects a different modifier", () => {
    expect(matchesModifier({ ...NONE, ctrlKey: true }, parseModifier("Cmd"))).toBe(false);
    expect(matchesModifier(NONE, parseModifier("Alt"))).toBe(false);
  });
});

describe("parseModifier", () => {
  it("разбирает спеку в набор флагов", () => {
    expect(parseModifier("Cmd+Shift")).toEqual({ ...NONE, metaKey: true, shiftKey: true });
    expect(parseModifier("Alt")).toEqual({ ...NONE, altKey: true });
  });

  it("понимает алиасы и регистр так же, как Rust split_combo", () => {
    expect(parseModifier("cmd+shift")).toEqual({ ...NONE, metaKey: true, shiftKey: true });
    expect(parseModifier("Meta+Shift")).toEqual({ ...NONE, metaKey: true, shiftKey: true });
    expect(parseModifier("control+option")).toEqual({ ...NONE, ctrlKey: true, altKey: true });
  });

  it("неизвестные токены дают пустой набор", () => {
    expect(parseModifier("")).toEqual(NONE);
    expect(parseModifier("Fn")).toEqual(NONE);
  });

  it("пустая семейная спека — не назначено", () => {
    expect(parseFamilyModifier("  ")).toBeNull();
    expect(parseFamilyModifier("Alt")).toEqual({ ...NONE, altKey: true });
  });

  it.each(PLATFORMS)(
    "каждое комбо из реестра Rust (%s) разбирается в непустой и уникальный набор флагов",
    (platform) => {
      const seen = new Set<string>();
      for (const combo of MODIFIER_COMBOS[platform]) {
        const parsed = parseModifier(combo);
        expect(Object.values(parsed).some(Boolean)).toBe(true);
        expect(seen.has(JSON.stringify(parsed))).toBe(false);
        seen.add(JSON.stringify(parsed));
      }
    },
  );

  it("в реестре Windows нет комбо с клавишей Win", () => {
    for (const combo of MODIFIER_COMBOS.windows) {
      expect(parseModifier(combo).metaKey).toBe(false);
    }
  });
});

describe("prepareCombo / matchesPrepared", () => {
  it("сочетание в любом регистре матчит то же нажатие", () => {
    const press = { ...NONE, metaKey: true, code: "KeyK" };
    expect(matchesPrepared(press, prepareCombo("Cmd+K"))).toBe(true);
    expect(matchesPrepared(press, prepareCombo("cmd+k"))).toBe(true);
    expect(matchesPrepared(press, prepareCombo("meta+KeyK"))).toBe(true);
  });

  it("спека без клавиши ничего не матчит", () => {
    expect(matchesPrepared({ ...NONE, metaKey: true, code: "KeyK" }, prepareCombo("Cmd"))).toBe(
      false,
    );
  });

  it("лишний модификатор или другая клавиша — не совпадение", () => {
    const prepared = prepareCombo("Cmd+K");
    expect(
      matchesPrepared({ ...NONE, metaKey: true, shiftKey: true, code: "KeyK" }, prepared),
    ).toBe(false);
    expect(matchesPrepared({ ...NONE, metaKey: true, code: "KeyJ" }, prepared)).toBe(false);
  });
});
