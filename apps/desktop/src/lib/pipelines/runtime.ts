import type { ChatMessageDto } from "@/ipc/types";
import type { ImagePayload } from "../composer";
import { libraryContextBlocks } from "../context-library";
import { textDigest } from "../digest";
import { errorMessage } from "../errors";
import { stripKeywordBlocks } from "../keywords";
import type {
  Pipeline,
  PipelineExecutionOptions,
  PipelineInput,
  PipelineModelRequest,
  PipelineNode,
  PipelineNodeResult,
  PipelinePort,
  PipelineResult,
} from "../pipeline-types";
import {
  DEFAULT_SEPARATOR,
  describePipelineIssue,
  executionOrder,
  graphIssues,
  orderedIncoming,
  validatePipeline,
  type PipelineIssue,
} from "./graph";

/**
 * A run refused or aborted for a reason the user can fix in the editor or the
 * request parameters. The message is already localized; `issues` keeps the
 * codes so the editor can point at the nodes.
 */
export class PipelineError extends Error {
  readonly issues: PipelineIssue[];

  constructor(message: string, issues: PipelineIssue[] = []) {
    super(message);
    this.name = "PipelineError";
    this.issues = issues;
  }

  static forIssues(pipeline: Pipeline, issues: PipelineIssue[]): PipelineError {
    return new PipelineError(
      issues.map((issue) => describePipelineIssue(pipeline, issue)).join("\n"),
      issues,
    );
  }
}

/** Groups retain their separators when duplicate raw documents disappear across branches. */
type Fragment = { text: string; documentId?: string } | { children: Fragment[]; separator: string };
interface Keyed<T> {
  key: string;
  value: T;
}
interface Value {
  fragments: Fragment[];
  images: Keyed<ImagePayload>[];
  history: Keyed<ChatMessageDto>[];
  keywords: Keyed<string>[];
  unresolved: string[];
}

export interface PipelinePreview extends PipelineResult {
  issues: PipelineIssue[];
  unresolvedNodeIds: string[];
  complete: boolean;
}

function emptyValue(): Value {
  return { fragments: [], images: [], history: [], keywords: [], unresolved: [] };
}

function uniqueValues<T>(values: Keyed<T>[]): Keyed<T>[] {
  const seen = new Set<string>();
  return values.filter(({ key }) => {
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function combine(values: Value[], separator = DEFAULT_SEPARATOR): Value {
  return {
    fragments: [{ children: values.flatMap((value) => value.fragments), separator }],
    images: uniqueValues(values.flatMap((value) => value.images)),
    history: uniqueValues(values.flatMap((value) => value.history)),
    keywords: uniqueValues(values.flatMap((value) => value.keywords)),
    unresolved: [...new Set(values.flatMap((value) => value.unresolved))],
  };
}

function render(value: Value): string {
  const seenDocuments = new Set<string>();
  function partText(part: Fragment): string {
    if ("children" in part) return part.children.map(partText).filter(Boolean).join(part.separator);
    if (part.documentId) {
      if (seenDocuments.has(part.documentId)) return "";
      seenDocuments.add(part.documentId);
    }
    return part.text;
  }
  return value.fragments.map(partText).filter(Boolean).join(DEFAULT_SEPARATOR);
}

function rawTextValue(text: string, key: string): Value {
  return {
    ...emptyValue(),
    fragments: [{ text: stripKeywordBlocks(text) }],
    keywords: [{ key, value: text }],
  };
}

function sourceValue(node: PipelineNode, input: PipelineInput): Value {
  if (!node.enabled) return emptyValue();
  switch (node.kind) {
    case "document":
    case "folder": {
      const ids =
        node.kind === "document"
          ? [node.sourceId]
          : (node.folderDocIds ??
            input.library.docs
              .filter((doc) => doc.folderId === node.sourceId)
              .map((doc) => doc.id));
      const docs = new Map(input.library.docs.map((doc) => [doc.id, doc]));
      return combine(
        ids.map((id) => {
          const doc = docs.get(id);
          if (!doc) return emptyValue(); // validatePipeline reports missing references before execution.
          return {
            ...emptyValue(),
            fragments: [
              {
                text: stripKeywordBlocks(libraryContextBlocks(input.library, [id])[0] ?? ""),
                documentId: id,
              },
            ],
            keywords: [{ key: `document:${id}`, value: doc.text }],
          };
        }),
        node.separator,
      );
    }
    case "preset":
      return rawTextValue(
        input.presets.find((preset) => preset.id === node.sourceId)?.text ?? "",
        `preset:${node.sourceId}`,
      );
    case "text":
      return rawTextValue(node.text, `text:${node.id}`);
    case "chatContext":
      return {
        ...rawTextValue(input.chatContextPending ? "" : input.chatContext, "chatContext"),
        unresolved: input.chatContextPending ? [node.id] : [],
        keywords: (input.chatContextKeywordSources ?? [input.chatContext]).map((value, index) => ({
          key: `chatContext:${index}`,
          value,
        })),
      };
    case "message":
      return {
        ...rawTextValue(input.message?.text ?? "", "message"),
        images: (input.message?.images ?? []).map((image, index) => ({
          key: `message:${index}`,
          value: image,
        })),
      };
    case "history":
      return {
        ...emptyValue(),
        history: input.history.map((message, index) => ({
          key: `history:${index}`,
          value: { ...message, text: stripKeywordBlocks(message.text) },
        })),
      };
    default:
      return emptyValue();
  }
}

function incomingValue(
  pipeline: Pipeline,
  node: PipelineNode,
  values: Map<string, Value>,
  port: PipelinePort,
): Value {
  return combine(
    orderedIncoming(pipeline, node)
      .filter((edge) => edge.targetPort === port)
      .map((edge) => values.get(edge.source) ?? emptyValue()),
    node.separator,
  );
}

function nodeInputs(pipeline: Pipeline, node: PipelineNode, values: Map<string, Value>) {
  return {
    input: incomingValue(pipeline, node, values, "input"),
    system: incomingValue(pipeline, node, values, "system"),
    history: incomingValue(pipeline, node, values, "history"),
  };
}

function issueForImages(node: PipelineNode, value: Value): PipelineIssue | null {
  return value.images.length ? { code: "unconsumed-images", nodeId: node.id } : null;
}

function modelRequest(
  node: PipelineNode,
  input: PipelineInput,
  values: ReturnType<typeof nodeInputs>,
): PipelineModelRequest {
  const system = combine([values.system, rawTextValue(node.text, `instruction:${node.id}`)]);
  const message: ChatMessageDto = {
    role: "user",
    text: render(values.input),
    images: values.input.images.map(({ value }) => value),
  };
  return {
    nodeId: node.id,
    messages: [...values.history.history.map(({ value }) => value), message],
    system: render(system),
    model: node.model || input.model,
    options: { ...input.options, thinking: node.thinking, webSearch: node.webSearch },
  };
}

function modelInputIssue(
  node: PipelineNode,
  values: ReturnType<typeof nodeInputs>,
): PipelineIssue | null {
  const imageIssue = issueForImages(node, values.system);
  if (imageIssue) return imageIssue;
  if (!values.input.unresolved.length && !render(values.input) && !values.input.images.length)
    return { code: "empty-input", nodeId: node.id };
  return null;
}

function modelMetadata(node: PipelineNode, values: ReturnType<typeof nodeInputs>): Value {
  return combine([
    values.input,
    values.system,
    values.history,
    rawTextValue(node.text, `instruction:${node.id}`),
  ]);
}

function completedModelValue(
  node: PipelineNode,
  inputs: ReturnType<typeof nodeInputs>,
  text: string,
): Value {
  const metadata = modelMetadata(node, inputs);
  // A model result is new content. It must not inherit the raw document IDs,
  // or two different rewrites of the same source would collapse when merged.
  return {
    ...emptyValue(),
    fragments: [{ text: stripKeywordBlocks(text) }],
    keywords: metadata.keywords,
  };
}

function initialResults(
  pipeline: Pipeline,
  order: PipelineNode[],
): Map<string, PipelineNodeResult> {
  const active = new Set(order.map((node) => node.id));
  return new Map(
    pipeline.nodes.map((node) => [
      node.id,
      { nodeId: node.id, status: active.has(node.id) ? "waiting" : "skipped", text: "" },
    ]),
  );
}

function resultFrom(
  pipeline: Pipeline,
  values: Map<string, Value>,
  results: Map<string, PipelineNodeResult>,
): PipelineResult {
  const output = pipeline.nodes.find((node) => node.kind === "output");
  return {
    text: output ? stripKeywordBlocks(render(values.get(output.id) ?? emptyValue())) : "",
    nodes: pipeline.nodes.flatMap((node) => {
      const result = results.get(node.id);
      return result ? [result] : [];
    }),
    keywordSources: uniqueValues([...values.values()].flatMap((value) => value.keywords)).map(
      ({ value }) => value,
    ),
  };
}

function passthroughOrSource(
  pipeline: Pipeline,
  node: PipelineNode,
  input: PipelineInput,
  values: Map<string, Value>,
): Value {
  // A bypassed model is the plain junction: it joins its ordered inputs with
  // its separator and passes them on without a call.
  return node.kind === "output" || node.kind === "llm"
    ? incomingValue(pipeline, node, values, "input")
    : sourceValue(node, input);
}

/** Never makes a network request, and never invents text for a model step. */
export function previewPipeline(pipeline: Pipeline, input: PipelineInput): PipelinePreview {
  const order = executionOrder(pipeline);
  const results = initialResults(pipeline, order);
  const values = new Map<string, Value>();
  const invalidNodes = new Set<string>();
  const issues = validatePipeline(pipeline, input);
  if (graphIssues(pipeline).length === 0) {
    for (const node of order) {
      let value: Value;
      let request: PipelineModelRequest | undefined;
      let requestComplete = false;
      const invalidAncestor = orderedIncoming(pipeline, node).some((edge) =>
        invalidNodes.has(edge.source),
      );
      if (node.kind === "llm" && node.enabled) {
        const inputs = nodeInputs(pipeline, node, values);
        const metadata = modelMetadata(node, inputs);
        const inputIssue = modelInputIssue(node, inputs);
        if (
          inputIssue &&
          !issues.some((issue) => issue.nodeId === node.id && issue.code === inputIssue.code)
        )
          issues.push(inputIssue);
        request = modelRequest(node, input, inputs);
        requestComplete =
          !invalidAncestor &&
          metadata.unresolved.length === 0 &&
          !issues.some((issue) => issue.nodeId === node.id);
        value = {
          ...emptyValue(),
          keywords: metadata.keywords,
          unresolved: [...metadata.unresolved, node.id],
        };
      } else {
        value = passthroughOrSource(pipeline, node, input, values);
      }
      if (node.kind === "output") {
        const imageIssue = issueForImages(node, value);
        if (imageIssue) issues.push(imageIssue);
        if (!value.unresolved.length && !render(value))
          issues.push({ code: "empty-output", nodeId: node.id });
      }
      values.set(node.id, value);
      const issue = issues.find((item) => item.nodeId === node.id);
      if (issue || invalidAncestor) invalidNodes.add(node.id);
      results.set(node.id, {
        nodeId: node.id,
        status: issue
          ? "error"
          : !node.enabled
            ? "skipped"
            : value.unresolved.length
              ? "waiting"
              : "complete",
        text: render(value),
        ...(request ? { request, requestComplete } : {}),
        ...(issue ? { error: describePipelineIssue(pipeline, issue) } : {}),
      });
    }
  }
  const result = resultFrom(pipeline, values, results);
  const unresolvedNodeIds = [...new Set([...values.values()].flatMap((value) => value.unresolved))];
  return {
    ...result,
    issues,
    unresolvedNodeIds,
    complete: issues.length === 0 && unresolvedNodeIds.length === 0,
  };
}

function abortError(): DOMException {
  return new DOMException("Pipeline execution was cancelled.", "AbortError");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

/** Cancel promptly even if the injected transport is still unwinding. */
async function abortable<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  let onAbort: (() => void) | undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([work(), cancelled]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

/** Only ancestors of the selected output execute, each dependency exactly once. */
export async function executePipeline(
  pipeline: Pipeline,
  input: PipelineInput,
  options: PipelineExecutionOptions,
): Promise<PipelineResult> {
  // A run reads one immutable revision, even when the user edits library files
  // or moves cards while a model request is in flight.
  const snapshot = structuredClone({ pipeline, input });
  const graph = snapshot.pipeline;
  const data = snapshot.input;
  throwIfAborted(options.signal);
  const order = executionOrder(graph);
  const results = initialResults(graph, order);
  const values = new Map<string, Value>();
  const update = (result: PipelineNodeResult): void => {
    results.set(result.nodeId, result);
    // Inspection callbacks cannot mutate the request that is about to be sent.
    options.onNode?.(structuredClone(result));
  };
  for (const result of results.values()) options.onNode?.({ ...result });
  const pendingContext =
    data.chatContextPending && order.find((node) => node.kind === "chatContext" && node.enabled);
  if (pendingContext) {
    const error = PipelineError.forIssues(graph, [
      { code: "context-pending", nodeId: pendingContext.id },
    ]);
    update({ nodeId: pendingContext.id, status: "error", text: "", error: error.message });
    throw error;
  }
  const issues = previewPipeline(graph, data).issues;
  if (issues.length) {
    for (const issue of issues) {
      if (issue.nodeId)
        update({
          nodeId: issue.nodeId,
          status: "error",
          text: "",
          error: describePipelineIssue(graph, issue),
        });
    }
    throw PipelineError.forIssues(graph, issues);
  }
  for (const node of order) {
    let request: PipelineModelRequest | undefined;
    try {
      throwIfAborted(options.signal);
      update({ nodeId: node.id, status: "running", text: "" });
      throwIfAborted(options.signal);
      let value: Value;
      if (node.kind === "llm" && node.enabled) {
        const inputs = nodeInputs(graph, node, values);
        const inputIssue = modelInputIssue(node, inputs);
        if (inputIssue) throw PipelineError.forIssues(graph, [inputIssue]);
        const preparedRequest = modelRequest(node, data, inputs);
        request = preparedRequest;
        update({ nodeId: node.id, status: "running", text: "", request, requestComplete: true });
        const text = await abortable(
          () => options.callModel(structuredClone(preparedRequest)),
          options.signal,
        );
        throwIfAborted(options.signal);
        value = completedModelValue(node, inputs, text);
      } else {
        value = passthroughOrSource(graph, node, data, values);
      }
      if (node.kind === "output") {
        const imageIssue = issueForImages(node, value);
        if (imageIssue) throw PipelineError.forIssues(graph, [imageIssue]);
        if (!render(value))
          throw PipelineError.forIssues(graph, [{ code: "empty-output", nodeId: node.id }]);
      }
      throwIfAborted(options.signal);
      values.set(node.id, value);
      update({
        nodeId: node.id,
        status: node.enabled ? "complete" : "skipped",
        text: render(value),
        ...(request ? { request, requestComplete: true } : {}),
      });
    } catch (error) {
      const cancelled = options.signal.aborted;
      update({
        nodeId: node.id,
        status: cancelled ? "cancelled" : "error",
        text: "",
        error: cancelled ? undefined : errorMessage(error),
        ...(request ? { request, requestComplete: true } : {}),
      });
      if (cancelled) {
        for (const result of results.values()) {
          if (result.status === "waiting") update({ ...result, status: "cancelled" });
        }
        throw abortError();
      }
      throw error;
    }
  }
  throwIfAborted(options.signal);
  return resultFrom(graph, values, results);
}

/** Layout and names are editorial; only data that affects a run invalidates its preparation. */
export function semanticPipelineFingerprint(pipeline: Pipeline, input: PipelineInput): string {
  const order = executionOrder(pipeline);
  const nodes = order.map((node) => {
    const common = { id: node.id, kind: node.kind, enabled: node.enabled };
    if (!node.enabled && node.kind !== "llm" && node.kind !== "output") return common;
    if (node.kind === "llm")
      return {
        ...common,
        separator: node.separator,
        ...(node.enabled
          ? {
              text: node.text,
              model: node.model || input.model,
              thinking: node.thinking,
              webSearch: node.webSearch,
            }
          : {}),
      };
    if (node.kind === "output") return { ...common, separator: node.separator };
    // The resolved value includes folder membership and document titles but no
    // unused library documents, unrelated presets or the editor's card names.
    return {
      ...common,
      sourceId: node.sourceId,
      pinned: node.folderDocIds,
      value: sourceValue(node, input),
    };
  });
  const edges = order.flatMap((node) =>
    orderedIncoming(pipeline, node).map(({ source, target, targetPort, order }) => ({
      source,
      target,
      targetPort,
      order,
    })),
  );
  const issues = validatePipeline(pipeline, input).map(({ code, nodeId, edgeId }) => ({
    code,
    nodeId,
    edgeId,
  }));
  return textDigest(JSON.stringify({ version: 1, kind: pipeline.kind, nodes, edges, issues }));
}
