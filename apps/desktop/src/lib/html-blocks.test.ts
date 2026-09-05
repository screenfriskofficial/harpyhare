import { describe, expect, it } from "vitest";
import { extractHtmlBlocks } from "./html-blocks";
import { systemDesignHtml } from "./system-design";

const DIAGRAM = JSON.stringify({
  version: 1,
  TITLE: "API v1",
  NODES: [{ id: "api", col: 0, kind: "service", title: "API" }],
  EDGES: [],
});

describe("extractHtmlBlocks", () => {
  it("извлекает одиночный закрытый блок", () => {
    const md = "Вот карточка:\n```html\n<p>привет</p>\n```\nготово";
    expect(extractHtmlBlocks(md)).toEqual(["<p>привет</p>"]);
  });

  it("извлекает несколько блоков по порядку", () => {
    const md = "```html\n<a>1</a>\n```\nтекст\n```html\n<b>2</b>\n<i>3</i>\n```";
    expect(extractHtmlBlocks(md)).toEqual(["<a>1</a>", "<b>2</b>\n<i>3</i>"]);
  });

  it("незакрытый fence не извлекается (стрим)", () => {
    expect(extractHtmlBlocks("```html\n<p>обрыв")).toEqual([]);
  });

  it("язык регистронезависим", () => {
    expect(extractHtmlBlocks("```HTML\n<b>x</b>\n```")).toEqual(["<b>x</b>"]);
  });

  it("другие языки игнорируются", () => {
    expect(extractHtmlBlocks("```js\nconst a = 1;\n```")).toEqual([]);
  });

  it("пустой и пробельный блоки не извлекаются", () => {
    expect(extractHtmlBlocks("```html\n```")).toEqual([]);
    expect(extractHtmlBlocks("```html\n   \n```")).toEqual([]);
  });

  it("текст без блоков — пустой массив", () => {
    expect(extractHtmlBlocks("обычный ответ про <html> без fence")).toEqual([]);
  });

  it("сохраняет порядок HTML и схем, пропускает ошибочную и незавершённую схему", () => {
    const md = `\`\`\`html\n<p>old</p>\n\`\`\`\n\`\`\`system-design\n{}\n\`\`\`\n\`\`\`SYSTEM-DESIGN\n${DIAGRAM}\n\`\`\`\n\`\`\`system-design\n${DIAGRAM}`;
    expect(extractHtmlBlocks(md)).toEqual(["<p>old</p>", systemDesignHtml(DIAGRAM)]);
  });
});
