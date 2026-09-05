import { isValidElement } from "react";
import { describe, expect, it } from "vitest";
import { splitRenderedLines, trimTrailingEmptyLine } from "./code-lines";

describe("splitRenderedLines", () => {
  it("режет обычную строку по переносам", () => {
    expect(splitRenderedLines("раз\nдва").length).toBe(2);
  });

  it("перенос внутри токена подсветки переоткрывает обёртку", () => {
    const highlighted = <span className="hljs-comment">{"/* первая\nвторая */"}</span>;
    const lines = splitRenderedLines(highlighted);
    expect(lines.length).toBe(2);
    for (const line of lines) {
      expect(line.length).toBe(1);
    }
  });

  it("пустая строка внутри токена даёт пустую обёртку, а не весь токен ещё раз", () => {
    const highlighted = <span className="hljs-comment">{"/*\n\n*/"}</span>;
    const lines = splitRenderedLines(highlighted);
    expect(lines.length).toBe(3);
    const middle = lines[1]?.[0];
    expect(isValidElement<{ children?: unknown }>(middle)).toBe(true);
    if (isValidElement<{ children?: unknown }>(middle)) {
      expect(middle.props.children).toBeNull();
    }
  });

  it("склеивает соседние узлы в одну строку", () => {
    const nodes = ["package ", <span key="k">main</span>, "\nfunc main() {}"];
    const lines = splitRenderedLines(nodes);
    expect(lines.length).toBe(2);
    expect(lines[0]?.length).toBe(2);
  });

  it("однострочный элемент не разбирается на части", () => {
    expect(splitRenderedLines(<span className="hljs-keyword">func</span>).length).toBe(1);
  });
});

describe("trimTrailingEmptyLine", () => {
  it("снимает пустой хвост после завершающего переноса", () => {
    expect(trimTrailingEmptyLine(splitRenderedLines("раз\nдва\n")).length).toBe(2);
  });

  it("единственную пустую строку не трогает", () => {
    expect(trimTrailingEmptyLine([[]]).length).toBe(1);
  });
});
