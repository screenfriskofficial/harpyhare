import { describe, expect, it } from "vitest";
import { chatPromptSources, chatSystemPrompt } from "./system-prompt";

const PRESETS = [{ id: "p1", name: "Интервью", text: "Отвечай кратко." }];

describe("chatPromptSources", () => {
  it("собирает препромпт и свой текст, пропуская пустое", () => {
    const sources = chatPromptSources(PRESETS, { presetId: "p1", context: "  проект X  " });
    expect(sources).toEqual([
      "Отвечай кратко.",
      "Контекст от пользователя (справочные материалы):\nпроект X",
    ]);
  });

  it("без препромпта и текста — пусто", () => {
    expect(chatPromptSources(PRESETS, { presetId: "", context: "" })).toEqual([]);
  });
});

describe("chatSystemPrompt", () => {
  it("склеивает источники пустой строкой и выкидывает блоки ключевых слов", () => {
    const prompt = chatSystemPrompt(["Первый", "[keywords]: [React, Rust]", "Второй"]);
    expect(prompt).toBe("Первый\n\nВторой");
  });
});
