import { describe, expect, it } from "vitest";
import { noteExcerpt, noteMatchCount } from "./notes-excerpt";

function rendered(parts: { text: string }[]): string {
  return parts.map((part) => part.text).join("");
}

function highlighted(parts: { text: string; match: boolean }[]): string[] {
  return parts.filter((part) => part.match).map((part) => part.text);
}

describe("noteExcerpt", () => {
  it("без совпадений показывает начало заметки", () => {
    const parts = noteExcerpt("Первая строка\n\nвторая строка", []);
    expect(rendered(parts)).toBe("Первая строка вторая строка");
    expect(highlighted(parts)).toEqual([]);
  });

  it("схлопывает переносы строк — цитата остаётся однострочной", () => {
    expect(rendered(noteExcerpt("а\n\n\tб   в", []))).toBe("а б в");
  });

  it("подсвечивает найденное слово в исходном регистре", () => {
    const parts = noteExcerpt("Конкурентный рендер в React", ["конкурентный"]);
    expect(highlighted(parts)).toEqual(["Конкурентный"]);
  });

  it("ищет ё и е как одну букву", () => {
    expect(highlighted(noteExcerpt("Ёлка в снегу", ["елка"]))).toEqual(["Ёлка"]);
  });

  it("вырезает окно вокруг совпадения, а не начало заметки", () => {
    const text = `${"я ".repeat(200)}иголка ${"я ".repeat(200)}`;
    const parts = noteExcerpt(text, ["иголка"]);
    expect(highlighted(parts)).toEqual(["иголка"]);
    expect(rendered(parts).startsWith("…")).toBe(true);
    expect(rendered(parts).endsWith("…")).toBe(true);
    expect(rendered(parts).length).toBeLessThan(text.length);
  });

  it("не ставит многоточие, когда заметка целиком помещается", () => {
    expect(rendered(noteExcerpt("Короткая заметка", ["заметка"]))).toBe("Короткая заметка");
  });

  it("подсвечивает все совпадения внутри окна", () => {
    expect(highlighted(noteExcerpt("тест и ещё тест", ["тест"]))).toEqual(["тест", "тест"]);
  });

  it("спецсимволы в слове ищутся буквально, а не как регулярка", () => {
    expect(highlighted(noteExcerpt("Пишу на C++ каждый день", ["c++"]))).toEqual(["C++"]);
    expect(highlighted(noteExcerpt("Пишу на Cxx каждый день", ["c++"]))).toEqual([]);
  });

  it("из двух совпавших слов подсвечивается длинное, а не его начало", () => {
    expect(highlighted(noteExcerpt("тестирование", ["тест", "тестирование"]))).toEqual([
      "тестирование",
    ]);
  });

  it("не режет эмодзи на границах окна", () => {
    const tailCut = noteExcerpt(`${"a".repeat(199)}😀 tail`, []);
    expect(rendered(tailCut).includes("\ufffd")).toBe(false);
    expect(rendered(tailCut)).toContain("😀");
    const headCut = noteExcerpt(`${"я".repeat(60)}😀${"я".repeat(47)}иголка`, ["иголка"]);
    expect(rendered(headCut).includes("\ufffd")).toBe(false);
  });

  it("пустая заметка не даёт частей", () => {
    expect(noteExcerpt("   \n  ", ["что-то"])).toEqual([]);
  });
});

describe("noteMatchCount", () => {
  it("считает совпадения по всей заметке, а не по цитате", () => {
    const text = `совпадение ${"я ".repeat(300)}совпадение`;
    expect(noteMatchCount(text, ["совпадение"])).toBe(2);
  });

  it("без слов поиска совпадений нет", () => {
    expect(noteMatchCount("любой текст", [])).toBe(0);
  });
});
