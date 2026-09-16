import { isRecord } from "./utils";

export type SystemDesignKind = "service" | "db" | "queue" | "client";

export interface SystemDesignNode {
  id: string;
  /** Layer, left to right: clients first, storage last. Consecutive from 0. */
  col: number;
  kind: SystemDesignKind;
  title: string;
  sub?: string[];
  badge?: string;
}

export interface SystemDesignEdge {
  from: string;
  to: string;
  label?: string;
  /** Dashed: a message on a queue rather than a call. */
  async?: boolean;
}

export interface SystemDesignGroup {
  label: string;
  nodes: string[];
}

/** The contract the system-design preset teaches the model; `version` is the format version. */
export interface SystemDesign {
  version: 1;
  TITLE: string;
  NODES: SystemDesignNode[];
  EDGES: SystemDesignEdge[];
  GROUPS: SystemDesignGroup[];
}

export const SYSTEM_DESIGN_KINDS: readonly SystemDesignKind[] = [
  "service",
  "db",
  "queue",
  "client",
];
const MAX_CODE_CHARS = 100_000;
const MAX_TEXT_CHARS = 120;
const MAX_TITLE_CHARS = 200;
const MAX_COLUMNS = 32;
const MAX_NODES = 80;
const MAX_EDGES = 200;
const MAX_GROUPS = 20;
const MAX_SUB_LINES = 3;

function text(value: unknown, max = MAX_TEXT_CHARS): value is string {
  return typeof value === "string" && value.length <= max;
}

function node(value: unknown): value is SystemDesignNode {
  return (
    isRecord(value) &&
    text(value["id"]) &&
    value["id"].trim() !== "" &&
    typeof value["col"] === "number" &&
    Number.isInteger(value["col"]) &&
    value["col"] >= 0 &&
    value["col"] < MAX_COLUMNS &&
    typeof value["kind"] === "string" &&
    SYSTEM_DESIGN_KINDS.some((kind) => kind === value["kind"]) &&
    text(value["title"]) &&
    value["title"].trim() !== "" &&
    (value["sub"] === undefined ||
      (Array.isArray(value["sub"]) &&
        value["sub"].length <= MAX_SUB_LINES &&
        value["sub"].every((s) => text(s)))) &&
    (value["badge"] === undefined || text(value["badge"]))
  );
}

function edge(value: unknown): value is SystemDesignEdge {
  return (
    isRecord(value) &&
    text(value["from"]) &&
    text(value["to"]) &&
    value["from"] !== value["to"] &&
    (value["label"] === undefined || text(value["label"])) &&
    (value["async"] === undefined || typeof value["async"] === "boolean")
  );
}

function group(value: unknown): value is SystemDesignGroup {
  return (
    isRecord(value) &&
    text(value["label"]) &&
    Array.isArray(value["nodes"]) &&
    value["nodes"].length > 0 &&
    value["nodes"].length <= MAX_NODES &&
    value["nodes"].every((id) => text(id))
  );
}

function design(
  value: unknown,
): value is Omit<SystemDesign, "GROUPS"> & { GROUPS?: SystemDesignGroup[] } {
  if (
    !isRecord(value) ||
    value["version"] !== 1 ||
    !text(value["TITLE"], MAX_TITLE_CHARS) ||
    !Array.isArray(value["NODES"]) ||
    value["NODES"].length === 0 ||
    value["NODES"].length > MAX_NODES ||
    !value["NODES"].every(node) ||
    !Array.isArray(value["EDGES"]) ||
    value["EDGES"].length > MAX_EDGES ||
    !value["EDGES"].every(edge) ||
    (value["GROUPS"] !== undefined &&
      (!Array.isArray(value["GROUPS"]) ||
        value["GROUPS"].length > MAX_GROUPS ||
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

/**
 * Only validated data becomes a diagram; incomplete JSON while streaming, or
 * a block the model got wrong, stays visible as code for correction.
 */
export function parseSystemDesign(code: string): SystemDesign | null {
  if (code.length > MAX_CODE_CHARS) return null;
  let data: unknown;
  try {
    data = JSON.parse(code);
  } catch {
    return null;
  }
  if (!design(data)) return null;
  return {
    version: 1,
    TITLE: data.TITLE,
    NODES: data.NODES,
    EDGES: data.EDGES,
    GROUPS: data.GROUPS ?? [],
  };
}
