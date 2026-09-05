import { describe, expect, it } from "vitest";
import { extractKeyterms, stripKeywordBlocks } from "./keywords";
import { mergePresets, OFFICIAL_PRESETS_FALLBACK, presetText, type PromptPreset } from "./presets";

const presets: PromptPreset[] = [
  { id: "a", name: "A", text: "текст-A" },
  { id: "b", name: "B", text: "текст-B" },
];

const preset = (id: string, name = id): PromptPreset => ({ id, name, text: id });

describe("presetText", () => {
  it("возвращает текст пресета по id", () => {
    expect(presetText(presets, "b")).toBe("текст-B");
  });
  it("неизвестный id → пустая строка", () => {
    expect(presetText(presets, "zzz")).toBe("");
  });
  it("пустой presetId → пустая строка", () => {
    expect(presetText(presets, "")).toBe("");
  });
});

describe("mergePresets", () => {
  it("официальные идут первыми, личные — следом", () => {
    expect(mergePresets([preset("off")], [preset("mine")])).toEqual([
      preset("off"),
      preset("mine"),
    ]);
  });
  it("официальный пресет побеждает при совпадении id", () => {
    const official = preset("transcription", "офиц");
    const local = preset("transcription", "локальный");
    expect(mergePresets([official], [local])).toEqual([official]);
  });
  it("личные без коллизий сохраняются", () => {
    expect(mergePresets([preset("a")], [preset("a"), preset("b")])).toEqual([
      preset("a"),
      preset("b"),
    ]);
  });
  it("пустой официальный пул отдаёт личные как есть", () => {
    expect(mergePresets([], [preset("x")])).toEqual([preset("x")]);
  });
});

describe("встроенные пресеты объявляют термины для распознавания", () => {
  it("пресеты укладываются в бюджет 3000 символов после удаления STT-терминов", () => {
    for (const preset of OFFICIAL_PRESETS_FALLBACK) {
      const prompt = stripKeywordBlocks(preset.text);
      expect(prompt.length, preset.id).toBeGreaterThan(0);
      expect(prompt.length, preset.id).toBeLessThanOrEqual(3000);
    }
  });

  it("у каждого пресета есть непустой блок [keywords]", () => {
    expect(OFFICIAL_PRESETS_FALLBACK.length).toBeGreaterThan(0);
    for (const preset of OFFICIAL_PRESETS_FALLBACK) {
      expect(extractKeyterms(preset.text).length, `пресет ${preset.id}`).toBeGreaterThan(0);
    }
  });

  it("ни один пресет не выходит за лимит вендора в одиночку", () => {
    // xAI отвечает ошибкой, а не обрезает, поэтому пресет, переваливший лимит
    // САМ ПО СЕБЕ, ломал бы запись до того, как к нему добавят контекст чата.
    for (const preset of OFFICIAL_PRESETS_FALLBACK) {
      expect(extractKeyterms(preset.text).length, `пресет ${preset.id}`).toBeLessThanOrEqual(100);
    }
  });

  it("объявление вырезается из текста, который уходит в модель", () => {
    for (const preset of OFFICIAL_PRESETS_FALLBACK) {
      expect(stripKeywordBlocks(preset.text), `пресет ${preset.id}`).not.toContain("[keywords]");
    }
  });

  it("термины не повторяются внутри одного пресета", () => {
    for (const preset of OFFICIAL_PRESETS_FALLBACK) {
      const terms = extractKeyterms(preset.text).map((t) => t.toLocaleLowerCase());
      expect(new Set(terms).size, `пресет ${preset.id}`).toBe(terms.length);
    }
  });
});
