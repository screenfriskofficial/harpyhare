import { describe, expect, it } from "vitest";
import {
  openFenceBody,
  openFenceLanguage,
  splitOpenFence,
  splitStableTail,
} from "./stream-markdown";

describe("splitStableTail", () => {
  it("режет по последней границе абзаца", () => {
    expect(splitStableTail("раз\n\nдва\n\nтри-хвост")).toEqual(["раз\n\nдва\n\n", "три-хвост"]);
  });

  it("без границ — всё уходит в хвост", () => {
    expect(splitStableTail("одна строка без пустых")).toEqual(["", "одна строка без пустых"]);
  });

  it("не режет внутри незакрытого код-блока", () => {
    const text = "текст\n\n```js\nconst a = 1;\n\nconst b = 2;";
    expect(splitStableTail(text)).toEqual(["текст\n\n", "```js\nconst a = 1;\n\nconst b = 2;"]);
  });

  it("закрытый код-блок попадает в стабильный префикс", () => {
    const text = "```js\nconst a = 1;\n```\n\nхвост";
    expect(splitStableTail(text)).toEqual(["```js\nconst a = 1;\n```\n\n", "хвост"]);
  });

  it("пустая строка и текст с ведущей границей не ломаются", () => {
    expect(splitStableTail("")).toEqual(["", ""]);
    expect(splitStableTail("\n\nхвост")).toEqual(["", "\n\nхвост"]);
  });

  it("граница в самом конце не считается: за ней ещё ничего не пришло", () => {
    expect(splitStableTail("абзац\n\n")).toEqual(["", "абзац\n\n"]);
  });

  it("~~~-блок с ``` внутри закрывается только своим маркером", () => {
    const text = "~~~\n```\nx\n~~~\n\nхвост";
    expect(splitStableTail(text)).toEqual(["~~~\n```\nx\n~~~\n\n", "хвост"]);
  });

  it("закрывающий маркер короче открывающего не закрывает блок", () => {
    const text = "````\n```\nx\n\nещё";
    expect(splitStableTail(text)).toEqual(["", text]);
  });

  it("не отрывает вложенный пункт с отступом от его списка", () => {
    const text = "1. Foo\n\n    - bar\n\n2. Baz\n\nабзац";
    expect(splitStableTail(text)).toEqual(["1. Foo\n\n    - bar\n\n2. Baz\n\n", "абзац"]);
  });

  it("не рвёт loose-список между пунктами", () => {
    const text = "Список:\n\n1. Foo\n\n2. Bar\n\n3. Baz";
    expect(splitStableTail(text)).toEqual(["Список:\n\n", "1. Foo\n\n2. Bar\n\n3. Baz"]);
  });

  it("список после абзаца — обычная граница", () => {
    expect(splitStableTail("Интро\n\n- пункт\n\n- ещё\n\nконец")).toEqual([
      "Интро\n\n- пункт\n\n- ещё\n\n",
      "конец",
    ]);
  });
});

describe("splitOpenFence", () => {
  it("без открытого блока — null", () => {
    expect(splitOpenFence("просто текст")).toBeNull();
    expect(splitOpenFence("```js\ncode\n```\nпосле")).toBeNull();
  });

  it("отделяет текст перед открытым блоком от самого блока", () => {
    expect(splitOpenFence("text\n```js\ncode")).toEqual(["text\n", "```js\ncode"]);
  });

  it("пустые строки перед маркером остаются в тексте, а не в блоке", () => {
    const [before, fenced] = splitOpenFence("text\n \n```js\ncode") ?? [];
    expect(before).toBe("text\n \n");
    expect(fenced).toBe("```js\ncode");
    expect(openFenceBody(fenced ?? "")).toBe("code");
  });

  it("ответ, начинающийся с пустых строк и блока, отдаёт чистое тело", () => {
    const [, fenced] = splitOpenFence("\n\n```js\ncode") ?? [];
    expect(openFenceBody(fenced ?? "")).toBe("code");
  });

  it("~~~ внутри открытого ```-блока его не закрывает", () => {
    expect(splitOpenFence("```\n~~~\nx")).toEqual(["", "```\n~~~\nx"]);
  });
});

describe("openFenceLanguage / openFenceBody", () => {
  it("язык — первое слово строки сведений, в нижнем регистре", () => {
    expect(openFenceLanguage("```TS title=x\ncode")).toBe("ts");
    expect(openFenceLanguage("~~~\ncode")).toBeNull();
  });

  it("тело — всё после строки маркера", () => {
    expect(openFenceBody("```js\na\nb")).toBe("a\nb");
    expect(openFenceBody("```js")).toBe("");
  });
});

// Так режет стрим `useStreamChunks` в AnswerPanel: граница ищется только в том,
// что дописали с прошлого кадра, а не во всём ответе.
function incrementalSplit(text: string): { chunks: string[]; tail: string } {
  let consumed = 0;
  const chunks: string[] = [];
  for (let end = 1; end <= text.length; end += 1) {
    const [settled] = splitStableTail(text.slice(consumed, end));
    if (settled !== "") {
      chunks.push(settled);
      consumed += settled.length;
    }
  }
  return { chunks, tail: text.slice(consumed) };
}

function fenceMarkerCount(text: string): number {
  return text.match(/^ {0,3}(?:```|~~~)/gm)?.length ?? 0;
}

describe("нарастающее деление стрима", () => {
  const withCode =
    "первый абзац\n\nвторой\n\n```go\nfunc main() {\n\n\tprintln(1)\n}\n```\n\nхвост";

  it("склеивается обратно в исходный текст", () => {
    const { chunks, tail } = incrementalSplit(withCode);
    expect(chunks.join("") + tail).toBe(withCode);
  });

  it("не режет незакрытый код-блок пополам", () => {
    const { chunks } = incrementalSplit(withCode);
    for (const chunk of chunks) {
      expect(fenceMarkerCount(chunk) % 2).toBe(0);
    }
  });

  it("даёт те же куски, что и деление целиком, для текста без кода", () => {
    const prose = "один\n\nдва\n\nтри";
    const { chunks, tail } = incrementalSplit(prose);
    const [stable, wholeTail] = splitStableTail(prose);
    expect(chunks.join("")).toBe(stable);
    expect(tail).toBe(wholeTail);
  });

  it("вложенный список не расходится по чанкам", () => {
    const nested = "Интро\n\n1. Foo\n\n    - bar\n\n2. Baz\n\nконец";
    const { chunks } = incrementalSplit(nested);
    expect(chunks).toEqual(["Интро\n\n", "1. Foo\n\n    - bar\n\n2. Baz\n\n"]);
  });
});
