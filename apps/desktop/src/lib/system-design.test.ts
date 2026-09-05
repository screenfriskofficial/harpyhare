import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { OFFICIAL_PRESETS_FALLBACK } from "./presets";
import { systemDesignHtml } from "./system-design";

const DATA = {
  version: 1,
  TITLE: "Feed v1",
  NODES: [
    { id: "client", col: 0, kind: "client", title: "Client", sub: [] },
    { id: "api", col: 1, kind: "service", title: "API", badge: "stateless xN" },
    { id: "queue", col: 2, kind: "queue", title: "Queue", sub: ["events"] },
    { id: "db", col: 2, kind: "db", title: "Database" },
  ],
  EDGES: [
    { from: "client", to: "api", label: "HTTPS" },
    { from: "api", to: "queue", label: "publish", async: true },
    { from: "client", to: "db", label: "read" },
    { from: "queue", to: "db", label: "write" },
    { from: "db", to: "api", label: "notify", async: true },
  ],
  GROUPS: [{ label: "Storage", nodes: ["queue", "db"] }],
};

function renderHtml(data: unknown): string {
  const html = systemDesignHtml(JSON.stringify(data));
  if (html === null) throw new Error("Expected a valid diagram");
  return html;
}

function renderedSvg(html: string): string {
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (script === undefined) throw new Error("Missing renderer");
  const sandbox = { __SVG: "" };
  runInNewContext(script, sandbox, { timeout: 1000 });
  return sandbox.__SVG;
}

describe("system design data → standalone HTML", () => {
  it("renders every node/edge kind, groups and zoom without external resources", () => {
    const html = renderHtml(DATA);
    const svg = renderedSvg(html);
    expect(svg).toContain("Feed v1");
    expect(svg).toContain("Storage");
    expect(svg).toContain("stateless xN");
    expect(svg).toContain('stroke-dasharray="7 5"');
    expect(svg).toContain("<ellipse");
    expect(svg).not.toMatch(/NaN|Infinity|undefined/);
    expect(html).toContain('"wheel"');
    expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=/);
    expect(html).not.toContain("__SYSTEM_DESIGN_DATA__");
  });

  it("accepts the exact example taught by the bundled preset", () => {
    const preset = OFFICIAL_PRESETS_FALLBACK.find((p) => p.id === "system-design");
    const example = /```system-design\n([\s\S]*?)\n```/.exec(preset?.text ?? "")?.[1];
    const html = systemDesignHtml(example ?? "");
    expect(html).not.toBeNull();
    expect(renderedSvg(html ?? "")).toContain("Service v1");
  });

  it("escapes script termination and SVG markup, preserving literal replacement tokens", () => {
    const title = '</script><script>alert("injected")</script> $&';
    const html = renderHtml({ ...DATA, TITLE: title });
    expect(html.match(/<script>/g)).toHaveLength(1);
    expect(html.match(/<\/script>/g)).toHaveLength(2);
    const svg = renderedSvg(html);
    expect(svg).toContain('&lt;/script&gt;&lt;script&gt;alert("injected")');
    expect(svg).toContain("$&amp;");
    expect(svg).not.toContain("<script>");
  });

  it("supports object-property names as node ids and omitted optional fields", () => {
    const html = renderHtml({
      version: 1,
      TITLE: "Safe ids",
      NODES: [
        { id: "__proto__", col: 0, kind: "client", title: "Client" },
        { id: "constructor", col: 1, kind: "service", title: "API" },
      ],
      EDGES: [{ from: "__proto__", to: "constructor" }],
    });
    expect(renderedSvg(html)).toContain("Safe ids");
  });

  it.each([
    null,
    {},
    { ...DATA, version: 2 },
    { ...DATA, NODES: [] },
    { ...DATA, NODES: [DATA.NODES[0], DATA.NODES[0]] },
    { ...DATA, NODES: [{ ...DATA.NODES[0], col: 1 }] },
    { ...DATA, NODES: [{ ...DATA.NODES[0], col: -1 }] },
    { ...DATA, NODES: [{ ...DATA.NODES[0], col: 0.5 }] },
    { ...DATA, NODES: [{ ...DATA.NODES[0], col: 32 }] },
    { ...DATA, NODES: [{ ...DATA.NODES[0], kind: ["client"] }] },
    { ...DATA, NODES: [{ ...DATA.NODES[0], sub: [42] }] },
    { ...DATA, EDGES: [{ from: "api", to: "unknown" }] },
    { ...DATA, EDGES: [{ from: "api", to: "api" }] },
    { ...DATA, GROUPS: [{ label: "Missing", nodes: ["unknown"] }] },
    { ...DATA, EDGES: Array.from({ length: 201 }, () => DATA.EDGES[0]) },
  ])("rejects malformed or unsupported data without executing it (%#)", (data) => {
    expect(systemDesignHtml(JSON.stringify(data))).toBeNull();
  });

  it("ignores incomplete JSON while streaming and caps input size", () => {
    expect(systemDesignHtml('{"version":1,')).toBeNull();
    expect(systemDesignHtml("x".repeat(100_001))).toBeNull();
  });
});
