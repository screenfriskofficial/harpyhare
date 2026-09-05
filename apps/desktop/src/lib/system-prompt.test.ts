import { describe, expect, it } from "vitest";
import { addDoc, EMPTY_LIBRARY } from "./context-library";
import { chatPromptSources, chatSystemPrompt } from "./system-prompt";

const PRESETS = [{ id: "p1", name: "Интервью", text: "Отвечай кратко." }];

describe("chatPromptSources", () => {
  it("собирает препромпт, материалы библиотеки и свой текст, пропуская пустое", () => {
    const library = addDoc(
      EMPTY_LIBRARY,
      { name: "Резюме", text: "опыт 5 лет", folderId: "" },
      "d1",
    );
    const sources = chatPromptSources(
      PRESETS,
      { presetId: "p1", libraryDocIds: ["d1", "ghost"], context: "  проект X  " },
      library,
    );
    expect(sources).toEqual([
      "Отвечай кратко.",
      "Справочный материал «Резюме»:\nопыт 5 лет",
      "Контекст от пользователя (справочные материалы):\nпроект X",
    ]);
  });

  it("без препромпта, материалов и текста — пусто", () => {
    expect(
      chatPromptSources(PRESETS, { presetId: "", libraryDocIds: [], context: "" }, EMPTY_LIBRARY),
    ).toEqual([]);
  });
});

describe("chatSystemPrompt", () => {
  it("склеивает источники пустой строкой и выкидывает блоки ключевых слов", () => {
    const prompt = chatSystemPrompt(["Первый", "[keywords]: [React, Rust]", "Второй"]);
    expect(prompt).toBe("Первый\n\nВторой");
  });
});
