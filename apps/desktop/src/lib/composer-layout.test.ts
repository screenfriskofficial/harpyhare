import { describe, expect, it } from "vitest";
import { composerCardHeight, composerZone } from "./composer-layout";

describe("composerZone", () => {
  it("свёрнутая карточка без быстрых действий: слот — строка поля, выноса нет", () => {
    expect(composerZone({ card: 40, row: 40, content: 74, bar: 0 }, 6)).toEqual({
      slot: 40,
      overflow: 0,
    });
  });

  it("раскрытая карточка выносится над лентой ровно на разницу со строкой поля", () => {
    expect(composerZone({ card: 74, row: 40, content: 74, bar: 0 }, 6)).toEqual({
      slot: 40,
      overflow: 34,
    });
  });

  it("во время анимации вынос следует за фактической высотой карточки", () => {
    expect(composerZone({ card: 57, row: 40, content: 74, bar: 0 }, 6).overflow).toBe(17);
  });

  it("полоса быстрых действий с зазором входит в слот и не считается выносом", () => {
    expect(composerZone({ card: 40, row: 40, content: 74, bar: 26 }, 6)).toEqual({
      slot: 72,
      overflow: 0,
    });
    expect(composerZone({ card: 74, row: 40, content: 74, bar: 26 }, 6)).toEqual({
      slot: 72,
      overflow: 34,
    });
  });

  it("выросшее поле поднимает и слот, и раскрытую карточку", () => {
    expect(composerZone({ card: 100, row: 60, content: 94, bar: 0 }, 6)).toEqual({
      slot: 60,
      overflow: 40,
    });
  });
});

describe("composerCardHeight", () => {
  it("раскрытая карточка — всё содержимое, свёрнутая — строка поля", () => {
    const measure = { card: 40, row: 40, content: 74, bar: 0 };
    expect(composerCardHeight(measure, true)).toBe(74);
    expect(composerCardHeight(measure, false)).toBe(40);
  });
});
