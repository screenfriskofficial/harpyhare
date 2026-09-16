import { useMemo } from "react";
import { chatRequestOptions, type Chat } from "@/lib/chats";
import type { ContextLibrary } from "@/lib/context-library";
import { chatKeyterms } from "@/lib/keywords";
import {
  chatPipelines,
  currentPreparedPrompt,
  pipelineKeytermSources,
  promptPipelineContext,
} from "@/lib/pipeline-keyterms";
import type { Pipeline } from "@/lib/pipeline-types";
import { semanticPipelineFingerprint } from "@/lib/pipelines";
import type { PromptPreset } from "@/lib/presets";
import { useSttKeyterms } from "./useSttKeyterms";

/**
 * Keeps the recogniser's vocabulary in step with the active chat, pipelines
 * included. Everything is keyed on the chat's scalars, so a keystroke in the
 * draft never digests the library into a fingerprint.
 */
export function usePipelineKeyterms(
  library: ContextLibrary,
  presets: PromptPreset[],
  pipelines: Pipeline[],
  chat: Chat,
): void {
  const { presetId, context, model, promptPipelineId, messagePipelineId, preparedPrompt } = chat;
  const { thinking, webSearch } = chatRequestOptions(chat);
  const prompt = useMemo(
    () =>
      promptPipelineContext(library, presets, { presetId, context }, model, {
        thinking,
        webSearch,
      }),
    [library, presets, presetId, context, model, thinking, webSearch],
  );
  const { promptPipeline, messagePipeline } = useMemo(
    () => chatPipelines(pipelines, { promptPipelineId, messagePipelineId }),
    [pipelines, promptPipelineId, messagePipelineId],
  );
  const fingerprint = useMemo(
    () => (promptPipeline ? semanticPipelineFingerprint(promptPipeline, prompt.context) : ""),
    [promptPipeline, prompt],
  );
  const prepared = currentPreparedPrompt(preparedPrompt, promptPipeline, fingerprint);
  const keyterms = useMemo(
    () =>
      chatKeyterms(
        pipelineKeytermSources({ ...prompt, promptPipeline, messagePipeline, prepared }),
      ),
    [prompt, promptPipeline, messagePipeline, prepared],
  );
  useSttKeyterms(keyterms);
}
