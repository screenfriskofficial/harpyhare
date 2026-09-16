import type { ChatMessageDto } from "@/ipc/types";
import type { RequestOptions } from "./chats";
import type { ContextLibrary } from "./context-library";
import type { PromptPreset } from "./presets";

export type PipelineKind = "prompt" | "message";
export type PipelineNodeKind =
  | "document"
  | "folder"
  | "preset"
  | "text"
  | "message"
  | "history"
  | "chatContext"
  | "llm"
  | "output";
export type PipelinePort = "input" | "system" | "history";

/** Domain data stays independent of the canvas library and its selection state. */
export interface PipelineNode {
  id: string;
  kind: PipelineNodeKind;
  name: string;
  position: { x: number; y: number };
  sourceId: string;
  text: string;
  model: string;
  enabled: boolean;
  thinking: boolean;
  webSearch: boolean;
  separator: string;
  /** Missing means the live folder; an array pins membership, not document contents. */
  folderDocIds?: string[];
}

export interface PipelineEdge {
  id: string;
  source: string;
  target: string;
  targetPort: PipelinePort;
  order: number;
}

export interface Pipeline {
  id: string;
  name: string;
  kind: PipelineKind;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
}

export interface PipelineLibrary {
  version: 1;
  pipelines: Pipeline[];
}

export interface PipelineInput {
  library: ContextLibrary;
  presets: PromptPreset[];
  message: ChatMessageDto | null;
  /** History excludes the current message so it is never submitted twice. */
  history: ChatMessageDto[];
  chatContext: string;
  /** Original declarations survive a previously prepared/stripped chat context. */
  chatContextKeywordSources?: string[];
  /** A selected preparation dependency has not produced this context yet. */
  chatContextPending?: boolean;
  model: string;
  options: RequestOptions;
}

export type PipelineNodeStatus =
  "waiting" | "running" | "complete" | "skipped" | "error" | "cancelled";

export interface PipelineNodeResult {
  nodeId: string;
  status: PipelineNodeStatus;
  text: string;
  error?: string;
  /** Exact model request, or its explicitly incomplete static projection. Never persisted in chats. */
  request?: PipelineModelRequest;
  requestComplete?: boolean;
}

/**
 * A prepared chat context: the text a prompt pipeline produced and the raw
 * sources its STT vocabulary is read from. A chat caches one as its
 * `preparedPrompt`; the launcher keeps one only as long as its screen.
 */
export interface PreparedContext {
  text: string;
  /** Sources contribute STT metadata independently of any model rewriting their text. */
  keywordSources: string[];
}

export interface PipelineResult extends PreparedContext {
  nodes: PipelineNodeResult[];
}

export interface PipelineModelRequest {
  nodeId: string;
  messages: ChatMessageDto[];
  system: string;
  model: string;
  options: RequestOptions;
}

export interface PipelineExecutionOptions {
  signal: AbortSignal;
  callModel: (request: PipelineModelRequest) => Promise<string>;
  onNode?: (result: PipelineNodeResult) => void;
}
