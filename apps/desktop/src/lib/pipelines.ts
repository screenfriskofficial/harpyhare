import type { RequestOptions } from "./chats";
import type { ContextLibrary } from "./context-library";
import type {
  Pipeline,
  PipelineInput,
  PipelineKind,
  PipelineLibrary,
  PipelineNode,
  PipelineNodeKind,
  PreparedContext,
} from "./pipeline-types";
import {
  canConnectPipelineNodes,
  DEFAULT_SEPARATOR,
  incomingEdges,
  type PipelineConnection,
} from "./pipelines/graph";
import { PipelineError } from "./pipelines/runtime";
import type { PromptPreset } from "./presets";

export {
  deserializePipelineLibrary,
  emptyPipelineLibrary,
  serializePipelineLibrary,
} from "./pipelines/codec";
export {
  allowedNodeKinds,
  canConnectPipelineNodes,
  DEFAULT_SEPARATOR,
  describePipelineIssue,
  incomingEdges,
  isPipelineNodeKind,
  isPipelinePort,
  PIPELINE_NODE_KINDS,
  PIPELINE_PORTS,
  pipelineNodeLabel,
  validatePipeline,
} from "./pipelines/graph";
export type { PipelineConnection, PipelineIssue, PipelineIssueCode } from "./pipelines/graph";
export {
  executePipeline,
  PipelineError,
  previewPipeline,
  semanticPipelineFingerprint,
} from "./pipelines/runtime";
export type { PipelinePreview } from "./pipelines/runtime";

const COLUMN_GAP = 320;
const ROW_GAP = 180;

/** No thinking and no web search: what a run without a chat behind it asks for. */
const NO_REQUEST_OPTIONS: RequestOptions = { thinking: false, webSearch: false };

export function createPipelineNode(
  kind: PipelineNodeKind,
  patch: Partial<PipelineNode> = {},
): PipelineNode {
  return {
    id: crypto.randomUUID(),
    kind,
    name: kind,
    position: { x: 0, y: 0 },
    sourceId: "",
    text: "",
    model: "",
    enabled: true,
    thinking: false,
    webSearch: false,
    separator: DEFAULT_SEPARATOR,
    ...structuredClone(patch),
  };
}

export function createPipeline(
  kind: PipelineKind,
  name = kind === "prompt" ? "Prompt pipeline" : "Message pipeline",
  id = crypto.randomUUID(),
): Pipeline {
  const output = createPipelineNode("output", {
    name: "Output",
    position: { x: COLUMN_GAP * (kind === "message" ? 2 : 1), y: ROW_GAP },
  });
  const source = createPipelineNode(kind === "message" ? "message" : "text", {
    name: kind === "message" ? "HUD message" : "System prompt",
    position: { x: 0, y: ROW_GAP },
  });
  let pipeline: Pipeline = { id, name, kind, nodes: [source, output], edges: [] };
  if (kind === "prompt")
    return connectPipelineNodes(pipeline, { source: source.id, target: output.id });
  const context = createPipelineNode("chatContext", {
    name: "Chat context",
    position: { x: 0, y: 0 },
  });
  const history = createPipelineNode("history", {
    name: "Chat history",
    position: { x: 0, y: ROW_GAP * 2 },
  });
  const model = createPipelineNode("llm", {
    name: "Answer",
    position: { x: COLUMN_GAP, y: ROW_GAP },
  });
  pipeline = { ...pipeline, nodes: [context, source, history, model, output] };
  for (const connection of [
    { source: source.id, target: model.id, targetPort: "input" as const },
    { source: context.id, target: model.id, targetPort: "system" as const },
    { source: history.id, target: model.id, targetPort: "history" as const },
    { source: model.id, target: output.id, targetPort: "input" as const },
  ])
    pipeline = connectPipelineNodes(pipeline, connection);
  return pipeline;
}

/** The saved pipelines of one kind, in library order. */
export function pipelinesOfKind(pipelines: readonly Pipeline[], kind: PipelineKind): Pipeline[] {
  return pipelines.filter((pipeline) => pipeline.kind === kind);
}

/**
 * The pipeline a chat slot points at, provided it still exists and is of the
 * kind the slot expects: a prompt slot never resolves to a message pipeline
 * even when the ids match, and an empty id is «none», not a broken reference.
 */
export function findPipeline(
  pipelines: readonly Pipeline[],
  id: string | undefined,
  kind: PipelineKind,
): Pipeline | undefined {
  if (!id) return undefined;
  return pipelines.find((pipeline) => pipeline.id === id && pipeline.kind === kind);
}

export interface PipelineInputSources {
  library: ContextLibrary;
  presets: PromptPreset[];
  model: string;
  /** Defaults to no thinking and no web search — a run without a chat behind it. */
  options?: RequestOptions;
  chatContext?: string;
  chatContextKeywordSources?: string[];
}

/**
 * The input of a pipeline before any message exists: what a prompt is prepared
 * from, what the launcher tests with and what the HUD reads its STT vocabulary
 * from. Message and history are absent on purpose — the fingerprint of a
 * preparation must not depend on them — and are attached at send time.
 */
export function pipelineInput(sources: PipelineInputSources): PipelineInput {
  const { chatContextKeywordSources } = sources;
  return {
    library: sources.library,
    presets: sources.presets,
    message: null,
    history: [],
    chatContext: sources.chatContext ?? "",
    ...(chatContextKeywordSources === undefined ? {} : { chatContextKeywordSources }),
    model: sources.model,
    options: sources.options ?? NO_REQUEST_OPTIONS,
  };
}

/**
 * The chat context as a prompt pipeline produced it — or, while that pipeline
 * has not run yet, an explicitly pending one whose STT vocabulary is already
 * known from a static preview, so recognition does not wait for the model.
 */
export function withPreparedContext(
  input: PipelineInput,
  prepared: PreparedContext | undefined,
  pendingKeywordSources: string[] = [],
): PipelineInput {
  return prepared
    ? {
        ...input,
        chatContext: prepared.text,
        chatContextPending: false,
        chatContextKeywordSources: prepared.keywordSources,
      }
    : {
        ...input,
        chatContext: "",
        chatContextPending: true,
        chatContextKeywordSources: pendingKeywordSources,
      };
}

export function upsertPipeline(library: PipelineLibrary, pipeline: Pipeline): PipelineLibrary {
  const copy = structuredClone(pipeline);
  return {
    ...library,
    pipelines: library.pipelines.some((item) => item.id === pipeline.id)
      ? library.pipelines.map((item) => (item.id === pipeline.id ? copy : item))
      : [...library.pipelines, copy],
  };
}

export function removePipeline(library: PipelineLibrary, id: string): PipelineLibrary {
  return { ...library, pipelines: library.pipelines.filter((pipeline) => pipeline.id !== id) };
}

export function updatePipelineNode(
  pipeline: Pipeline,
  id: string,
  patch: Partial<PipelineNode>,
): Pipeline {
  return {
    ...pipeline,
    nodes: pipeline.nodes.map((node) =>
      node.id === id ? { ...node, ...structuredClone(patch), id: node.id } : node,
    ),
  };
}

/** Cards moved: positions are editorial, nothing a run reads changes. Unknown ids are ignored. */
export function movePipelineNodes(
  pipeline: Pipeline,
  positions: ReadonlyMap<string, PipelineNode["position"]>,
): Pipeline {
  if (positions.size === 0) return pipeline;
  return {
    ...pipeline,
    nodes: pipeline.nodes.map((node) => {
      const position = positions.get(node.id);
      return position ? { ...node, position } : node;
    }),
  };
}

/** Removes nodes and connections together; a connection whose end is removed goes with it. */
export function removePipelineItems(
  pipeline: Pipeline,
  removed: { nodeIds?: Iterable<string>; edgeIds?: Iterable<string> },
): Pipeline {
  const nodeIds = new Set(removed.nodeIds ?? []);
  const edgeIds = new Set(removed.edgeIds ?? []);
  return {
    ...pipeline,
    nodes: pipeline.nodes.filter((node) => !nodeIds.has(node.id)),
    edges: pipeline.edges.filter(
      (edge) => !edgeIds.has(edge.id) && !nodeIds.has(edge.source) && !nodeIds.has(edge.target),
    ),
  };
}

export function removePipelineNode(pipeline: Pipeline, id: string): Pipeline {
  return removePipelineItems(pipeline, { nodeIds: [id] });
}

export function connectPipelineNodes(pipeline: Pipeline, connection: PipelineConnection): Pipeline {
  const code = canConnectPipelineNodes(pipeline, connection);
  if (code) throw PipelineError.forIssues(pipeline, [{ code, nodeId: connection.target }]);
  const targetPort = connection.targetPort ?? "input";
  const siblings = pipeline.edges.filter(
    (edge) => edge.target === connection.target && edge.targetPort === targetPort,
  );
  const order = connection.order ?? Math.max(-1, ...siblings.map((edge) => edge.order)) + 1;
  return {
    ...pipeline,
    edges: [
      ...pipeline.edges,
      {
        id: connection.id ?? crypto.randomUUID(),
        source: connection.source,
        target: connection.target,
        targetPort,
        order,
      },
    ],
  };
}

export function removePipelineEdge(pipeline: Pipeline, id: string): Pipeline {
  return removePipelineItems(pipeline, { edgeIds: [id] });
}

/**
 * Moves one incoming connection of its target up or down (`delta` −1 / +1)
 * among that target's inputs and renumbers them densely. At the bounds the
 * pipeline comes back unchanged, so callers can skip the no-op by identity.
 */
export function movePipelineEdge(pipeline: Pipeline, edgeId: string, delta: number): Pipeline {
  const edge = pipeline.edges.find((item) => item.id === edgeId);
  if (!edge) return pipeline;
  const ordered = incomingEdges(pipeline, edge.target);
  const index = ordered.findIndex((item) => item.id === edgeId);
  const nextIndex = index + delta;
  if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) return pipeline;
  const reordered = [...ordered];
  reordered.splice(index, 1);
  reordered.splice(nextIndex, 0, edge);
  const orders = new Map(reordered.map((item, order) => [item.id, order]));
  return {
    ...pipeline,
    edges: pipeline.edges.map((item) => {
      const order = orders.get(item.id);
      return order === undefined || order === item.order ? item : { ...item, order };
    }),
  };
}
