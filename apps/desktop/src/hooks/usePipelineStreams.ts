import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { t } from "@/i18n";
import type { ChatMessageDto } from "@/ipc/types";
import type { Chat } from "@/lib/chats";
import type { ContextLibrary } from "@/lib/context-library";
import { errorMessage, internalError, isAppError, type AppError } from "@/lib/errors";
import { notify } from "@/lib/notify";
import { runNativePipeline } from "@/lib/pipeline-run";
import type {
  Pipeline,
  PipelineInput,
  PipelineResult,
  PreparedContext,
} from "@/lib/pipeline-types";
import {
  findPipeline,
  PipelineError,
  pipelineInput,
  semanticPipelineFingerprint,
  withPreparedContext,
} from "@/lib/pipelines";
import type { PromptPreset } from "@/lib/presets";
import { chatPromptSources } from "@/lib/system-prompt";
import type { ChatsApi } from "./useChats";
import type { ClaudeStreams } from "./useClaudeStream";
import { useLatestRef } from "./useLatestRef";
import type { PipelinesApi } from "./usePipelines";

/** A graph the HUD is executing for a chat. */
interface GraphRun {
  startedAt: number;
  /** Names the pipeline for the answer panel's caption; `null` while the legacy answer streams after a prepared prompt. */
  pipelineName: string | null;
}

function omitKey<T>(value: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _omitted, ...rest } = value;
  return rest;
}

function mapValues<T, U>(record: Record<string, T>, map: (value: T) => U): Record<string, U> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, map(value)]));
}

/**
 * The system prompt for this send: the prompt pipeline's cached preparation
 * while nothing it read has changed, otherwise a fresh run whose result is
 * cached on the chat — unless the user switched pipelines meanwhile.
 */
async function prepareSystemPrompt(
  chat: Chat,
  pipeline: Pipeline,
  context: PipelineInput,
  chats: RefObject<ChatsApi>,
  signal: AbortSignal,
  onRun: () => void,
): Promise<PreparedContext> {
  const fingerprint = semanticPipelineFingerprint(pipeline, context);
  const cached = chat.preparedPrompt;
  if (cached?.pipelineId === pipeline.id && cached.fingerprint === fingerprint) return cached;
  onRun();
  const result = await runNativePipeline(pipeline, context, signal);
  signal.throwIfAborted();
  const current = chats.current.chats.find((item) => item.id === chat.id);
  if (current?.promptPipelineId === pipeline.id) {
    chats.current.patchChat(chat.id, {
      preparedPrompt: {
        pipelineId: pipeline.id,
        fingerprint,
        text: result.text,
        keywordSources: result.keywordSources,
      },
    });
  }
  return result;
}

/** The message graph sees the prepared context plus the message and its history; its stages never become chat messages. */
function runMessageGraph(
  pipeline: Pipeline,
  context: PipelineInput,
  messages: ChatMessageDto[],
  signal: AbortSignal,
): Promise<PipelineResult> {
  return runNativePipeline(
    pipeline,
    { ...context, message: messages.at(-1) ?? null, history: messages.slice(0, -1) },
    signal,
  );
}

/**
 * A `PipelineError` is configuration the user fixes in the editor or the request
 * parameters, so its localized text is shown as is; a native step failure is
 * typed and goes through the same reporter as a legacy `llm-error`.
 */
function reportFailure(cause: unknown, onError: (error: AppError) => void): AppError {
  if (cause instanceof PipelineError) {
    notify({ variant: "error", title: t("hud.pipelines.failedTitle"), message: cause.message });
    return internalError(cause.message);
  }
  const error = isAppError(cause) ? cause : internalError(errorMessage(cause));
  onError(error);
  return error;
}

/** The graph lifecycle wraps every send path without changing legacy streaming. */
export function usePipelineStreams(
  legacy: ClaudeStreams,
  pipelines: PipelinesApi,
  chatsRef: RefObject<ChatsApi>,
  libraryRef: RefObject<ContextLibrary>,
  presetsRef: RefObject<PromptPreset[]>,
  onComplete: (chatId: string, text: string) => void,
  onError: (error: AppError) => void,
) {
  const legacyRef = useLatestRef(legacy);
  const pipelinesRef = useLatestRef(pipelines);
  const completeRef = useLatestRef(onComplete);
  const errorRef = useLatestRef(onError);
  const active = useRef(new Map<string, AbortController>());
  const [graphRuns, setGraphRuns] = useState<Record<string, GraphRun>>({});
  /** Outlives its run on purpose: `null` masks a legacy error the graph superseded. */
  const [errors, setErrors] = useState<Record<string, AppError | null>>({});
  const endRun = useCallback((chatId: string) => {
    setGraphRuns((state) => omitKey(state, chatId));
  }, []);
  const nameRun = useCallback((chatId: string, pipelineName: string | null) => {
    setGraphRuns((state) => {
      const run = state[chatId];
      return run ? { ...state, [chatId]: { ...run, pipelineName } } : state;
    });
  }, []);
  const cancelGraph = useCallback(
    (chatId: string) => {
      active.current.get(chatId)?.abort();
      active.current.delete(chatId);
      endRun(chatId);
    },
    [endRun],
  );
  const cancelAll = useCallback(() => {
    for (const controller of active.current.values()) controller.abort();
    active.current.clear();
    setGraphRuns({});
  }, []);
  useEffect(() => {
    const runs = active.current;
    return () => {
      for (const controller of runs.values()) controller.abort();
      runs.clear();
    };
  }, []);

  const send = useCallback<ClaudeStreams["send"]>(
    async (chatId, messages, system, model, options) => {
      if (active.current.has(chatId) || legacyRef.current.isStreaming(chatId)) return;
      const chat = chatsRef.current.chats.find((item) => item.id === chatId);
      if (!chat) return;
      setErrors((state) => omitKey(state, chatId));
      if (!chat.promptPipelineId && !chat.messagePipelineId) {
        await legacyRef.current.send(chatId, messages, system, model, options);
        return;
      }
      setErrors((state) => ({ ...state, [chatId]: null }));
      const controller = new AbortController();
      active.current.set(chatId, controller);
      setGraphRuns((state) => ({
        ...state,
        [chatId]: { startedAt: Date.now(), pipelineName: null },
      }));
      const current = () => active.current.get(chatId) === controller && !controller.signal.aborted;
      try {
        if (!pipelinesRef.current.loaded) throw new PipelineError(t("hud.pipelines.notLoaded"));
        const definitions = pipelinesRef.current.library.pipelines;
        // A prompt is prepared without the message: the HUD computes the same
        // fingerprint from the same context, so its cache is only reused when
        // nothing the preparation read has changed.
        let context = pipelineInput({
          library: libraryRef.current,
          presets: presetsRef.current,
          model,
          options,
          chatContext: system,
          chatContextKeywordSources: chatPromptSources(presetsRef.current, chat),
        });
        if (chat.promptPipelineId) {
          const pipeline = findPipeline(definitions, chat.promptPipelineId, "prompt");
          if (!pipeline) throw new PipelineError(t("hud.pipelines.promptUnavailable"));
          const prepared = await prepareSystemPrompt(
            chat,
            pipeline,
            context,
            chatsRef,
            controller.signal,
            () => {
              nameRun(chatId, pipeline.name);
            },
          );
          context = withPreparedContext(context, prepared);
          system = context.chatContext;
        }
        controller.signal.throwIfAborted();
        if (chat.messagePipelineId) {
          const pipeline = findPipeline(definitions, chat.messagePipelineId, "message");
          if (!pipeline) throw new PipelineError(t("hud.pipelines.messageUnavailable"));
          nameRun(chatId, pipeline.name);
          const result = await runMessageGraph(pipeline, context, messages, controller.signal);
          if (current()) completeRef.current(chatId, result.text);
        } else {
          // The original answer still streams; graph stages never become chat messages.
          setErrors((state) => omitKey(state, chatId));
          nameRun(chatId, null);
          await legacyRef.current.send(chatId, messages, system, model, options);
        }
      } catch (cause) {
        if (current()) {
          const error = reportFailure(cause, errorRef.current);
          setErrors((state) => ({ ...state, [chatId]: error }));
        }
      } finally {
        if (active.current.get(chatId) === controller) {
          active.current.delete(chatId);
          endRun(chatId);
        }
      }
    },
    [
      chatsRef,
      libraryRef,
      presetsRef,
      legacyRef,
      pipelinesRef,
      completeRef,
      errorRef,
      endRun,
      nameRun,
    ],
  );
  const isStreaming = useCallback(
    (id: string) => active.current.has(id) || legacyRef.current.isStreaming(id),
    [legacyRef],
  );
  const stop = useCallback(
    (id: string) => {
      cancelGraph(id);
      legacyRef.current.stop(id);
    },
    [cancelGraph, legacyRef],
  );
  const discard = useCallback(
    (id: string) => {
      cancelGraph(id);
      legacyRef.current.discard(id);
    },
    [cancelGraph, legacyRef],
  );
  /** The name of the pipeline a chat is executing, for the answer panel's caption. */
  const running = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(graphRuns).flatMap(([chatId, run]): [string, string][] =>
          run.pipelineName === null ? [] : [[chatId, run.pipelineName]],
        ),
      ),
    [graphRuns],
  );
  const stream: ClaudeStreams = {
    ...legacy,
    streaming: { ...legacy.streaming, ...mapValues(graphRuns, () => true) },
    startedAt: { ...legacy.startedAt, ...mapValues(graphRuns, (run) => run.startedAt) },
    error: { ...legacy.error, ...errors },
    send,
    stop,
    discard,
    isStreaming,
  };
  return { stream, running, cancelAll };
}
