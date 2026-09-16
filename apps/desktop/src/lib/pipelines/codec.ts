import type { Pipeline, PipelineEdge, PipelineLibrary, PipelineNode } from "../pipeline-types";
import { isRecord } from "../utils";
import {
  DEFAULT_SEPARATOR,
  graphIssues,
  isPipelineNodeKind,
  isPipelinePort,
  type PipelineIssueCode,
} from "./graph";

const EDITABLE_ISSUES: ReadonlySet<PipelineIssueCode> = new Set<PipelineIssueCode>([
  "output-count",
  "kind-mismatch",
]);

function isNode(value: unknown): value is PipelineNode {
  if (!isRecord(value) || !isRecord(value["position"])) return false;
  const position = value["position"];
  return (
    typeof value["id"] === "string" &&
    value["id"].trim() !== "" &&
    typeof value["kind"] === "string" &&
    isPipelineNodeKind(value["kind"]) &&
    typeof value["name"] === "string" &&
    typeof value["sourceId"] === "string" &&
    typeof value["text"] === "string" &&
    typeof value["model"] === "string" &&
    typeof value["separator"] === "string" &&
    typeof value["enabled"] === "boolean" &&
    typeof value["thinking"] === "boolean" &&
    typeof value["webSearch"] === "boolean" &&
    typeof position["x"] === "number" &&
    Number.isFinite(position["x"]) &&
    typeof position["y"] === "number" &&
    Number.isFinite(position["y"]) &&
    (value["folderDocIds"] === undefined ||
      (Array.isArray(value["folderDocIds"]) &&
        value["folderDocIds"].every((id: unknown) => typeof id === "string" && id.trim() !== "") &&
        new Set(value["folderDocIds"]).size === value["folderDocIds"].length))
  );
}

function isEdge(value: unknown): value is PipelineEdge {
  if (!isRecord(value)) return false;
  return (
    typeof value["id"] === "string" &&
    value["id"].trim() !== "" &&
    typeof value["source"] === "string" &&
    typeof value["target"] === "string" &&
    typeof value["targetPort"] === "string" &&
    isPipelinePort(value["targetPort"]) &&
    typeof value["order"] === "number" &&
    Number.isSafeInteger(value["order"]) &&
    value["order"] >= 0
  );
}

function isPipeline(value: unknown): value is Pipeline {
  if (!isRecord(value)) return false;
  if (
    typeof value["id"] !== "string" ||
    !value["id"].trim() ||
    typeof value["name"] !== "string" ||
    (value["kind"] !== "prompt" && value["kind"] !== "message") ||
    !Array.isArray(value["nodes"]) ||
    !value["nodes"].every(isNode) ||
    !Array.isArray(value["edges"]) ||
    !value["edges"].every(isEdge)
  )
    return false;
  // A user can save a draft with its output temporarily deleted or a node the
  // pipeline kind no longer allows: the editor shows both as issues to fix.
  // Malformed references, cycles or unknown kinds are never silently repaired.
  const pipeline: Pipeline = {
    id: value["id"],
    name: value["name"],
    kind: value["kind"],
    nodes: value["nodes"],
    edges: value["edges"],
  };
  return graphIssues(pipeline).every((issue) => EDITABLE_ISSUES.has(issue.code));
}

/** A library with nothing in it yet — what a first launch starts from. */
export function emptyPipelineLibrary(): PipelineLibrary {
  return { version: 1, pipelines: [] };
}

export function serializePipelineLibrary(library: PipelineLibrary): string {
  return JSON.stringify(library);
}

/** Empty storage is new, null is corrupt/unsupported: callers must not overwrite null with defaults. */
export function deserializePipelineLibrary(json: string): PipelineLibrary | null {
  if (json.trim() === "") return emptyPipelineLibrary();
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (
    !isRecord(raw) ||
    raw["version"] !== 1 ||
    !Array.isArray(raw["pipelines"]) ||
    !raw["pipelines"].every(isPipeline)
  )
    return null;
  const pipelines = raw["pipelines"];
  if (new Set(pipelines.map((pipeline) => pipeline.id)).size !== pipelines.length) return null;
  return { version: 1, pipelines: pipelines.map(withSeparators) };
}

/**
 * An empty separator cannot be chosen any more: it glued prompt blocks into
 * one line, and nobody wants that. A file written by the earlier free-text
 * field is read as the default instead of being refused or kept broken.
 */
function withSeparators(pipeline: Pipeline): Pipeline {
  return pipeline.nodes.every((node) => node.separator !== "")
    ? pipeline
    : {
        ...pipeline,
        nodes: pipeline.nodes.map((node) =>
          node.separator === "" ? { ...node, separator: DEFAULT_SEPARATOR } : node,
        ),
      };
}
