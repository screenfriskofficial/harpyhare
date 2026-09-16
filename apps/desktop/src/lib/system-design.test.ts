import { describe, expect, it } from "vitest";
import { OFFICIAL_PRESETS_FALLBACK } from "./presets";
import { parseSystemDesign } from "./system-design";
import { layoutSystemDesign } from "./system-design-layout";

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

function parsed(data: unknown) {
  const design = parseSystemDesign(JSON.stringify(data));
  if (design === null) throw new Error("Expected a valid diagram");
  return design;
}

describe("parseSystemDesign", () => {
  it("accepts the contract and fills the optional groups", () => {
    expect(parsed(DATA).GROUPS).toEqual(DATA.GROUPS);
    expect(parsed({ ...DATA, GROUPS: undefined }).GROUPS).toEqual([]);
  });

  it("accepts the exact example taught by the bundled preset", () => {
    const preset = OFFICIAL_PRESETS_FALLBACK.find((p) => p.id === "system-design");
    const example = /```system-design\n([\s\S]*?)\n```/.exec(preset?.text ?? "")?.[1];
    expect(parseSystemDesign(example ?? "")?.TITLE).toBe("Service v1");
  });

  it("supports object-property names as node ids and omitted optional fields", () => {
    const design = parsed({
      version: 1,
      TITLE: "Safe ids",
      NODES: [
        { id: "__proto__", col: 0, kind: "client", title: "Client" },
        { id: "constructor", col: 1, kind: "service", title: "API" },
      ],
      EDGES: [{ from: "__proto__", to: "constructor" }],
    });
    expect(layoutSystemDesign(design).nodes.map((node) => node.id)).toEqual([
      "__proto__",
      "constructor",
    ]);
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
  ])("rejects malformed or unsupported data (%#)", (data) => {
    expect(parseSystemDesign(JSON.stringify(data))).toBeNull();
  });

  it("ignores incomplete JSON while streaming and caps input size", () => {
    expect(parseSystemDesign('{"version":1,')).toBeNull();
    expect(parseSystemDesign("x".repeat(100_001))).toBeNull();
  });
});
