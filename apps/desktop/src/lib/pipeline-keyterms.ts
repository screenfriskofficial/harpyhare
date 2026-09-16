import type { Chat, PreparedPrompt, RequestOptions } from "./chats";
import type { ContextLibrary } from "./context-library";
import type { Pipeline, PipelineInput } from "./pipeline-types";
import { findPipeline, pipelineInput, previewPipeline } from "./pipelines";
import type { PromptPreset } from "./presets";
import { chatPromptSources, chatSystemPrompt, type PromptChat } from "./system-prompt";

export interface PromptPipelineContext {
  /** Every raw text the chat contributes to its system prompt, `[keywords]` blocks still inside. */
  sources: string[];
  /** What a prompt pipeline is prepared from: no message, no history. */
  context: PipelineInput;
}

/**
 * The chat as the pipelines see it before a message exists: a prompt is
 * prepared from it, and the STT vocabulary is read from it. It has to match
 * what `usePipelineStreams` builds on send — the prepared prompt is reused
 * only when the two fingerprints agree.
 */
export function promptPipelineContext(
  library: ContextLibrary,
  presets: PromptPreset[],
  chat: PromptChat,
  model: string,
  options: RequestOptions,
): PromptPipelineContext {
  const sources = chatPromptSources(presets, chat);
  return {
    sources,
    context: pipelineInput({
      library,
      presets,
      model,
      options,
      chatContext: chatSystemPrompt(sources),
      chatContextKeywordSources: sources,
    }),
  };
}

export interface ChatPipelines {
  promptPipeline: Pipeline | undefined;
  messagePipeline: Pipeline | undefined;
}

/**
 * The pipelines a chat points at; a dangling id — or an id of a pipeline of
 * the other kind — resolves to nothing, as if none were chosen, exactly as
 * `usePipelineStreams` resolves it on send.
 */
export function chatPipelines(
  pipelines: Pipeline[],
  chat: Pick<Chat, "promptPipelineId" | "messagePipelineId">,
): ChatPipelines {
  return {
    promptPipeline: findPipeline(pipelines, chat.promptPipelineId, "prompt"),
    messagePipeline: findPipeline(pipelines, chat.messagePipelineId, "message"),
  };
}

/** The prepared prompt counts only if this pipeline produced it from these exact sources. */
export function currentPreparedPrompt(
  prepared: PreparedPrompt | undefined,
  promptPipeline: Pipeline | undefined,
  fingerprint: string,
): PreparedPrompt | null {
  if (!promptPipeline || !prepared) return null;
  const current = prepared.pipelineId === promptPipeline.id && prepared.fingerprint === fingerprint;
  return current ? prepared : null;
}

export interface KeytermSourcesInput extends ChatPipelines, PromptPipelineContext {
  prepared: PreparedPrompt | null;
}

function promptKeytermSources({
  context,
  sources,
  promptPipeline,
  prepared,
}: Omit<KeytermSourcesInput, "messagePipeline">): string[] {
  if (prepared) return prepared.keywordSources;
  if (promptPipeline) return previewPipeline(promptPipeline, context).keywordSources;
  return sources;
}

/**
 * The raw texts the STT vocabulary is declared in, after the pipelines have
 * had their say: a prompt pipeline replaces the chat's own sources with what
 * it assembles (or assembled, when its prepared prompt is current), and a
 * message pipeline reads that system prompt through its chat-context node.
 */
export function pipelineKeytermSources(input: KeytermSourcesInput): string[] {
  const sources = promptKeytermSources(input);
  if (!input.messagePipeline) return sources;
  return previewPipeline(input.messagePipeline, {
    ...input.context,
    chatContext: input.prepared ? input.prepared.text : input.context.chatContext,
    chatContextKeywordSources: sources,
  }).keywordSources;
}
