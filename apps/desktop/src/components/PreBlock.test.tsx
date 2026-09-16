import { cleanup, fireEvent, render } from "@testing-library/react";
import Markdown from "react-markdown";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PreviewContent } from "@/lib/html-blocks";
import { REHYPE_PLUGINS, REMARK_PLUGINS } from "./markdown-config";
import { makePre } from "./PreBlock";

afterEach(cleanup);

const DIAGRAM = JSON.stringify({
  version: 1,
  TITLE: "API v1",
  NODES: [{ id: "api", col: 0, kind: "service", title: "API" }],
  EDGES: [],
});

function previewBlock(language: string, body: string, withPreview = true) {
  const onToggle = vi.fn<(content: PreviewContent) => void>();
  const ui = render(
    <Markdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={REHYPE_PLUGINS}
      components={{ pre: makePre(withPreview ? onToggle : undefined) }}
    >
      {`\`\`\`${language}\n${body}\n\`\`\``}
    </Markdown>,
  );
  return { ...ui, onToggle };
}

describe("preview code blocks", () => {
  it.each(["system-design", "SYSTEM-DESIGN"])("opens %s as a validated diagram", (language) => {
    const { getByRole, container, onToggle } = previewBlock(language, DIAGRAM);
    fireEvent.click(getByRole("button", { name: /Открыть превью/ }));
    const opened = onToggle.mock.calls[0]?.[0];
    expect(opened?.kind).toBe("system-design");
    expect(opened?.kind === "system-design" ? opened.design.TITLE : "").toBe("API v1");
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
    expect(html.onToggle).toHaveBeenCalledWith({
      kind: "html",
      code: "<p>Original</p>\n",
      html: "<p>Original</p>\n",
    });
  });

  it("shows a preview block as plain code where there is no panel to open it in", () => {
    const { queryByRole, container } = previewBlock("html", "<p>Original</p>", false);
    expect(queryByRole("button", { name: /Открыть превью/ })).toBeNull();
    expect(container.querySelector("pre code")?.textContent).toContain("<p>Original</p>");
  });
});
