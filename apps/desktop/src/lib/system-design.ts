import { withDiagramViewport } from "./diagram-viewport";
import template from "./system-design-template.html?raw";

interface DiagramNode {
  id: string;
  col: number;
  kind: "service" | "db" | "queue" | "client";
  title: string;
  sub?: string[];
  badge?: string;
}

interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
  async?: boolean;
}

interface DiagramGroup {
  label: string;
  nodes: string[];
}

interface Diagram {
  version: 1;
  TITLE: string;
  NODES: DiagramNode[];
  EDGES: DiagramEdge[];
  GROUPS?: DiagramGroup[];
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max = 120): value is string {
  return typeof value === "string" && value.length <= max;
}

function node(value: unknown): value is DiagramNode {
  return (
    record(value) &&
    text(value["id"]) &&
    value["id"].trim() !== "" &&
    typeof value["col"] === "number" &&
    Number.isInteger(value["col"]) &&
    value["col"] >= 0 &&
    value["col"] < 32 &&
    typeof value["kind"] === "string" &&
    ["service", "db", "queue", "client"].includes(value["kind"]) &&
    text(value["title"]) &&
    value["title"].trim() !== "" &&
    (value["sub"] === undefined ||
      (Array.isArray(value["sub"]) &&
        value["sub"].length <= 3 &&
        value["sub"].every((s) => text(s)))) &&
    (value["badge"] === undefined || text(value["badge"]))
  );
}

function edge(value: unknown): value is DiagramEdge {
  return (
    record(value) &&
    text(value["from"]) &&
    text(value["to"]) &&
    value["from"] !== value["to"] &&
    (value["label"] === undefined || text(value["label"])) &&
    (value["async"] === undefined || typeof value["async"] === "boolean")
  );
}

function group(value: unknown): value is DiagramGroup {
  return (
    record(value) &&
    text(value["label"]) &&
    Array.isArray(value["nodes"]) &&
    value["nodes"].length > 0 &&
    value["nodes"].length <= 80 &&
    value["nodes"].every((id) => text(id))
  );
}

function diagram(value: unknown): value is Diagram {
  if (
    !record(value) ||
    value["version"] !== 1 ||
    !text(value["TITLE"], 200) ||
    !Array.isArray(value["NODES"]) ||
    value["NODES"].length === 0 ||
    value["NODES"].length > 80 ||
    !value["NODES"].every(node) ||
    !Array.isArray(value["EDGES"]) ||
    value["EDGES"].length > 200 ||
    !value["EDGES"].every(edge) ||
    (value["GROUPS"] !== undefined &&
      (!Array.isArray(value["GROUPS"]) ||
        value["GROUPS"].length > 20 ||
        !value["GROUPS"].every(group)))
  )
    return false;

  const ids = new Set(value["NODES"].map((n) => n.id));
  const cols = new Set(value["NODES"].map((n) => n.col));
  return (
    ids.size === value["NODES"].length &&
    Math.max(...cols) + 1 === cols.size &&
    value["EDGES"].every((e) => ids.has(e.from) && ids.has(e.to)) &&
    (value["GROUPS"] === undefined ||
      value["GROUPS"].every((g) => g.nodes.every((id) => ids.has(id))))
  );
}

/** Only validated JSON becomes executable HTML. Incomplete streaming data stays code. */
export function systemDesignHtml(code: string): string | null {
  if (code.length > 100_000) return null;
  let data: unknown;
  try {
    data = JSON.parse(code);
  } catch {
    return null;
  }
  if (!diagram(data)) return null;
  // A literal </script> in JSON must never terminate the enclosing script tag.
  const json = JSON.stringify({ ...data, GROUPS: data.GROUPS ?? [] })
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return withDiagramViewport(template.replace("__SYSTEM_DESIGN_DATA__", () => json));
}
