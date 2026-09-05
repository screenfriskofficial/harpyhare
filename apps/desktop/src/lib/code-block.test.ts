import { describe, expect, it } from "vitest";
import { codeLineCount, languageFromClassName, linesLabel } from "./code-block";

describe("codeLineCount", () => {
  it("завершающий перенос не считается лишней строкой", () => {
    expect(codeLineCount("один\nдва\n")).toBe(2);
  });
  it("одна строка без переноса", () => {
    expect(codeLineCount("println(1)")).toBe(1);
  });
});

describe("linesLabel", () => {
  it("склоняет по последней цифре", () => {
    expect(linesLabel(1)).toBe("1 строка");
    expect(linesLabel(3)).toBe("3 строки");
    expect(linesLabel(7)).toBe("7 строк");
    expect(linesLabel(21)).toBe("21 строка");
    expect(linesLabel(22)).toBe("22 строки");
  });

  it("одиннадцать–четырнадцать — исключение", () => {
    expect(linesLabel(11)).toBe("11 строк");
    expect(linesLabel(12)).toBe("12 строк");
    expect(linesLabel(14)).toBe("14 строк");
    expect(linesLabel(111)).toBe("111 строк");
  });
});

describe("languageFromClassName", () => {
  it("достаёт язык из класса подсветки", () => {
    expect(languageFromClassName("hljs language-go")).toBe("go");
  });

  it("служебные подписи не считаются языком", () => {
    expect(languageFromClassName("hljs language-plaintext")).toBeNull();
    expect(languageFromClassName("hljs")).toBeNull();
    expect(languageFromClassName(undefined)).toBeNull();
  });
});
