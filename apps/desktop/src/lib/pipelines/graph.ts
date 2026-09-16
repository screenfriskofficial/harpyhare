import { t } from "@/i18n";
import type {
  Pipeline,
  PipelineEdge,
  PipelineInput,
  PipelineKind,
  PipelineNode,
  PipelineNodeKind,
  PipelinePort,
} from "../pipeline-types";

/** Every code has a localized message in `pipelines.issues`; the domain never composes prose. */
export type PipelineIssueCode =
  | "output-count"
  | "duplicate-id"
  | "missing-node"
  | "invalid-port"
  | "invalid-source"
  | "duplicate-edge"
  | "invalid-order"
  | "cycle"
  | "kind-mismatch"
  | "missing-input"
  | "empty-input"
  | "missing-document"
  | "missing-folder"
  | "missing-preset"
  | "empty-text"
  | "missing-message"
  | "missing-model"
  | "unconsumed-images"
  | "empty-output"
  | "context-pending";

/** What joins a node's ordered inputs unless the node says otherwise: a blank line between blocks. */
export const DEFAULT_SEPARATOR = "\n\n";

export interface PipelineIssue {
  code: PipelineIssueCode;
  nodeId?: string;
  edgeId?: string;
}

export interface PipelineConnection {
  source: string;
  target: string;
  targetPort?: PipelinePort;
  order?: number;
  id?: string;
}

export const PIPELINE_NODE_KINDS: readonly PipelineNodeKind[] = [
  "document",
  "folder",
  "preset",
  "text",
  "message",
  "history",
  "chatContext",
  "llm",
  "output",
];

export const PIPELINE_PORTS: readonly PipelinePort[] = ["input", "system", "history"];

export function isPipelineNodeKind(value: string): value is PipelineNodeKind {
  return PIPELINE_NODE_KINDS.some((kind) => kind === value);
}

export function isPipelinePort(value: string): value is PipelinePort {
  return PIPELINE_PORTS.some((port) => port === value);
}

/**
 * A prompt is prepared ahead of any message, so the message and the history
 * do not exist for it. Allowing those nodes there would make the preparation
 * depend on data the HUD only has at send time — and never match its cache.
 */
const SEND_ONLY_KINDS: ReadonlySet<PipelineNodeKind> = new Set(["message", "history"]);

export function allowedNodeKinds(kind: PipelineKind): PipelineNodeKind[] {
  return PIPELINE_NODE_KINDS.filter((item) => kind === "message" || !SEND_ONLY_KINDS.has(item));
}

export function pipelineNodeLabel(node: PipelineNode): string {
  return node.name || t(`pipelines.nodeTypes.${node.kind}`);
}

/** The message for people; `PipelineIssue` itself stays a code so fingerprints and tests compare codes. */
export function describePipelineIssue(pipeline: Pipeline, issue: PipelineIssue): string {
  const node = pipeline.nodes.find((item) => item.id === issue.nodeId);
  return t(`pipelines.issues.${issue.code}`, { node: node ? pipelineNodeLabel(node) : "" });
}

/** Ties in `order` break on the id, so two connections never swap places between renders. */
function compareEdges(a: PipelineEdge, b: PipelineEdge): number {
  if (a.order !== b.order) return a.order - b.order;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Every connection into a node, in the order its inputs are joined. */
export function incomingEdges(pipeline: Pipeline, nodeId: string): PipelineEdge[] {
  return pipeline.edges.filter((edge) => edge.target === nodeId).sort(compareEdges);
}

/** The connections a run reads: a bypassed model keeps only its data input. */
export function orderedIncoming(pipeline: Pipeline, node: PipelineNode): PipelineEdge[] {
  return incomingEdges(pipeline, node.id).filter(
    (edge) => node.kind !== "llm" || node.enabled || edge.targetPort === "input",
  );
}

function connectionIssue(pipeline: Pipeline, edge: PipelineEdge): PipelineIssue | null {
  const source = pipeline.nodes.find((node) => node.id === edge.source);
  const target = pipeline.nodes.find((node) => node.id === edge.target);
  const issue = (code: PipelineIssueCode): PipelineIssue => ({
    code,
    edgeId: edge.id,
    nodeId: edge.target,
  });
  if (!source || !target) return issue("missing-node");
  if (source.kind === "output") return issue("invalid-source");
  if (target.kind !== "llm" && target.kind !== "output") return issue("invalid-port");
  if (edge.targetPort !== "input" && target.kind !== "llm") return issue("invalid-port");
  if ((source.kind === "history") !== (edge.targetPort === "history")) {
    return issue("invalid-source");
  }
  if (
    pipeline.edges.some(
      (other) =>
        other !== edge &&
        other.source === edge.source &&
        other.target === edge.target &&
        other.targetPort === edge.targetPort,
    )
  ) {
    return issue("duplicate-edge");
  }
  return null;
}

function containsCycle(pipeline: Pipeline): boolean {
  const children = new Map(pipeline.nodes.map((node) => [node.id, [] as string[]]));
  const pending = new Map(pipeline.nodes.map((node) => [node.id, 0]));
  for (const edge of pipeline.edges) {
    if (!children.has(edge.source) || !pending.has(edge.target)) continue;
    children.get(edge.source)?.push(edge.target);
    pending.set(edge.target, (pending.get(edge.target) ?? 0) + 1);
  }
  const ready = [...pending].filter(([, count]) => count === 0).map(([id]) => id);
  let visited = 0;
  for (const id of ready) {
    visited++;
    for (const next of children.get(id) ?? []) {
      const count = (pending.get(next) ?? 0) - 1;
      pending.set(next, count);
      if (count === 0) ready.push(next);
    }
  }
  return visited !== pending.size;
}

export function graphIssues(pipeline: Pipeline): PipelineIssue[] {
  const issues: PipelineIssue[] = [];
  if (pipeline.nodes.filter((node) => node.kind === "output").length !== 1) {
    issues.push({ code: "output-count" });
  }
  for (const items of [pipeline.nodes, pipeline.edges]) {
    const ids = new Set<string>();
    for (const item of items) {
      if (ids.has(item.id)) issues.push({ code: "duplicate-id" });
      ids.add(item.id);
    }
  }
  const allowed = new Set(allowedNodeKinds(pipeline.kind));
  for (const node of pipeline.nodes) {
    if (!allowed.has(node.kind)) issues.push({ code: "kind-mismatch", nodeId: node.id });
  }
  for (const edge of pipeline.edges) {
    const issue = connectionIssue(pipeline, edge);
    if (issue) issues.push(issue);
  }
  if (containsCycle(pipeline)) issues.push({ code: "cycle" });
  return issues;
}

/** Dependency order is determined by explicit connection order, never by card coordinates. */
export function executionOrder(pipeline: Pipeline): PipelineNode[] {
  const nodes = new Map(pipeline.nodes.map((node) => [node.id, node]));
  const output = pipeline.nodes.find((node) => node.kind === "output");
  const visited = new Set<string>();
  const result: PipelineNode[] = [];
  function visit(node: PipelineNode): void {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    for (const edge of orderedIncoming(pipeline, node)) {
      const source = nodes.get(edge.source);
      if (source) visit(source);
    }
    result.push(node);
  }
  if (output) visit(output);
  return result;
}

/** `null` when the connection can be added; otherwise the reason it cannot. */
export function canConnectPipelineNodes(
  pipeline: Pipeline,
  connection: PipelineConnection,
): PipelineIssueCode | null {
  const edge: PipelineEdge = {
    id: connection.id ?? "candidate",
    source: connection.source,
    target: connection.target,
    targetPort: connection.targetPort ?? "input",
    order: connection.order ?? 0,
  };
  if (connection.id && pipeline.edges.some((existing) => existing.id === connection.id))
    return "duplicate-id";
  if (!Number.isSafeInteger(edge.order) || edge.order < 0) return "invalid-order";
  const candidate = { ...pipeline, edges: [...pipeline.edges, edge] };
  const issue = connectionIssue(candidate, edge);
  if (issue) return issue.code;
  return containsCycle(candidate) ? "cycle" : null;
}

/** Incomplete drafts remain saveable; only reachable sources are required to run. */
export function validatePipeline(pipeline: Pipeline, input?: PipelineInput): PipelineIssue[] {
  const issues = graphIssues(pipeline);
  if (issues.length > 0) return issues;
  for (const node of executionOrder(pipeline)) {
    const add = (code: PipelineIssueCode) => issues.push({ code, nodeId: node.id });
    const incoming = orderedIncoming(pipeline, node);
    if (
      (node.kind === "llm" || node.kind === "output") &&
      !incoming.some((edge) => edge.targetPort === "input")
    ) {
      add("missing-input");
    }
    if (!node.enabled) continue;
    if (node.kind === "text" && !node.text.trim()) add("empty-text");
    if (!input) continue;
    if (node.kind === "document" && !input.library.docs.some((doc) => doc.id === node.sourceId)) {
      add("missing-document");
    }
    if (node.kind === "folder") {
      if (
        node.sourceId !== "" &&
        !input.library.folders.some((folder) => folder.id === node.sourceId)
      ) {
        add("missing-folder");
      }
      if (node.folderDocIds?.some((id) => !input.library.docs.some((doc) => doc.id === id))) {
        add("missing-document");
      }
    }
    if (node.kind === "preset" && !input.presets.some((preset) => preset.id === node.sourceId)) {
      add("missing-preset");
    }
    if (node.kind === "message" && !input.message) add("missing-message");
    if (node.kind === "llm" && !(node.model || input.model).trim()) add("missing-model");
  }
  return issues;
}
