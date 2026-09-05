import { cleanup, fireEvent, render } from "@testing-library/react";
import Markdown from "react-markdown";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REHYPE_PLUGINS, REMARK_PLUGINS } from "./markdown-config";
import { makePre } from "./PreBlock";

afterEach(cleanup);

const DIAGRAM = JSON.stringify({
  version: 1,
  TITLE: "API v1",
  NODES: [{ id: "api", col: 0, kind: "service", title: "API" }],
  EDGES: [],
});

function previewBlock(language: string, body: string) {
  const onToggle = vi.fn();
  const ui = render(
    <Markdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={REHYPE_PLUGINS}
      components={{ pre: makePre(onToggle) }}
    >
      {`\`\`\`${language}\n${body}\n\`\`\``}
    </Markdown>,
  );
  return { ...ui, onToggle };
}

describe("preview code blocks", () => {
  it.each(["system-design", "SYSTEM-DESIGN"])("opens %s as complete HTML", (language) => {
    const { getByRole, container, onToggle } = previewBlock(language, DIAGRAM);
    fireEvent.click(getByRole("button", { name: /Открыть превью/ }));
    expect(onToggle).toHaveBeenCalledWith(expect.stringContaining("<!doctype html>"));
    expect(onToggle).toHaveBeenCalledWith(expect.stringContaining("API v1"));
    expect(container.querySelector("code.hljs")).toBeNull();
  });

  it.each(["{}", '{"version":1,'])(
    "keeps invalid/incomplete data visible for correction",
    (body) => {
      const { queryByRole, container, onToggle } = previewBlock("system-design", body);
      expect(queryByRole("button", { name: /Открыть превью/ })).toBeNull();
      expect(container.textContent).toContain(body);
      expect(onToggle).not.toHaveBeenCalled();
    },
  );

  it("leaves unrelated JSON as code and existing HTML as an HTML preview", () => {
    const json = previewBlock("json", DIAGRAM);
    expect(json.queryByRole("button", { name: /Открыть превью/ })).toBeNull();
    json.unmount();
    const html = previewBlock("html", "<p>Original</p>");
    fireEvent.click(html.getByRole("button", { name: /Открыть превью/ }));
    expect(html.onToggle).toHaveBeenCalledWith("<p>Original</p>\n");
  });
});
