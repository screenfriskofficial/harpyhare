import { describe, expect, it } from "vitest";
import { extractPreviewBlocks, previewContent } from "./html-blocks";

const DIAGRAM = JSON.stringify({
  version: 1,
  TITLE: "API v1",
  NODES: [{ id: "api", col: 0, kind: "service", title: "API" }],
  EDGES: [],
});

function summary(markdown: string): string[] {
  return extractPreviewBlocks(markdown).map((block) =>
    block.kind === "html" ? block.html : `design:${block.design.TITLE}`,
  );
}

describe("extractPreviewBlocks", () => {
  it("извлекает одиночный закрытый блок", () => {
    const md = "Вот карточка:\n```html\n<p>привет</p>\n```\nготово";
    expect(summary(md)).toEqual(["<p>привет</p>"]);
  });

  it("извлекает несколько блоков по порядку", () => {
    const md = "```html\n<a>1</a>\n```\nтекст\n```html\n<b>2</b>\n<i>3</i>\n```";
    expect(summary(md)).toEqual(["<a>1</a>", "<b>2</b>\n<i>3</i>"]);
  });

  it("незакрытый fence не извлекается (стрим)", () => {
    expect(summary("```html\n<p>обрыв")).toEqual([]);
  });

  it("язык регистронезависим", () => {
    expect(summary("```HTML\n<b>x</b>\n```")).toEqual(["<b>x</b>"]);
  });

  it("другие языки игнорируются", () => {
    expect(summary("```js\nconst a = 1;\n```")).toEqual([]);
  });

  it("пустой и пробельный блоки не извлекаются", () => {
    expect(summary("```html\n```")).toEqual([]);
    expect(summary("```html\n   \n```")).toEqual([]);
  });

  it("текст без блоков — пустой массив", () => {
    expect(summary("обычный ответ про <html> без fence")).toEqual([]);
  });

  it("сохраняет порядок HTML и схем, пропускает ошибочную и незавершённую схему", () => {
    const md = `\`\`\`html\n<p>old</p>\n\`\`\`\n\`\`\`system-design\n{}\n\`\`\`\n\`\`\`SYSTEM-DESIGN\n${DIAGRAM}\n\`\`\`\n\`\`\`system-design\n${DIAGRAM}`;
    expect(summary(md)).toEqual(["<p>old</p>", "design:API v1"]);
  });

  it("схема несёт исходный JSON для копирования и сравнения", () => {
    const content = previewContent("system-design", DIAGRAM);
    expect(content).toMatchObject({ kind: "system-design", code: DIAGRAM });
    expect(previewContent("system-design", "{}")).toBeNull();
  });
});
