import { useCallback, useEffect, useRef, useState } from "react";
import { cancelStream, sendToClaude } from "@/ipc/commands";
import { onEvent } from "@/ipc/events";
import type { ChatMessageDto } from "@/ipc/types";
import type { RequestOptions } from "@/lib/chats";
import { internalError, type AppError } from "@/lib/errors";
import { notifyAppError } from "@/lib/notify";
import { advanceReveal, sliceRevealed } from "@/lib/stream-reveal";
import { useLatestRef } from "./useLatestRef";

export interface ClaudeStreams {
  partial: Record<string, string>;
  streaming: Record<string, boolean>;
  startedAt: Record<string, number>;
  error: Record<string, AppError | null>;
  /**
   * Синхронный гейт «чат уже стримит». Флаг `streaming` — state и отстаёт на
   * рендер: два вызова `send` в одном тике прошли бы его оба, и второй
   * сбрасывал бы буфер первого без `onComplete`.
   */
  isStreaming: (chatId: string) => boolean;
  send: (
    chatId: string,
    messages: ChatMessageDto[],
    system: string,
    model: string,
    options: RequestOptions,
  ) => Promise<void>;
  /** Останавливает стрим и отдаёт частичный ответ через `onComplete`. */
  stop: (chatId: string) => void;
  /** Останавливает стрим и выбрасывает частичный ответ: чат закрывают, коммитить некуда. */
  discard: (chatId: string) => void;
}

export function useClaudeStream(
  onComplete: (chatId: string, finalText: string) => void,
  onUsage: (chatId: string, inputTokens: number) => void,
): ClaudeStreams {
  const [partial, setPartial] = useState<Record<string, string>>({});
  const [streaming, setStreaming] = useState<Record<string, boolean>>({});
  const [startedAt, setStartedAt] = useState<Record<string, number>>({});
  const [error, setError] = useState<Record<string, AppError | null>>({});

  const buffers = useRef<Map<string, string>>(new Map());
  const revealed = useRef<Map<string, number>>(new Map());
  const active = useRef<Set<string>>(new Set());
  const streamIds = useRef<Map<string, string>>(new Map());
  const raf = useRef(0);
  const running = useRef(false);
  const lastFrameTs = useRef(0);

  const isCurrentStream = useCallback(
    (chatId: string, streamId: string) => streamIds.current.get(chatId) === streamId,
    [],
  );

  const onCompleteRef = useLatestRef(onComplete);
  const onUsageRef = useLatestRef(onUsage);

  const frame = useCallback<FrameRequestCallback>((frameTs) => {
    if (active.current.size === 0) {
      running.current = false;
      lastFrameTs.current = 0;
      return;
    }
    const dtMs = lastFrameTs.current === 0 ? 0 : frameTs - lastFrameTs.current;
    lastFrameTs.current = frameTs;
    const updates: Record<string, string> = {};
    for (const id of active.current) {
      const full = buffers.current.get(id) ?? "";
      const shown = advanceReveal(revealed.current.get(id) ?? 0, full.length, dtMs);
      revealed.current.set(id, shown);
      updates[id] = sliceRevealed(full, shown);
    }
    setPartial((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [id, text] of Object.entries(updates)) {
        if (next[id] !== text) {
          next[id] = text;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    raf.current = requestAnimationFrame(frame);
  }, []);

  const ensureRevealLoop = useCallback(() => {
    if (running.current) return;
    running.current = true;
    lastFrameTs.current = 0;
    raf.current = requestAnimationFrame(frame);
  }, [frame]);

  const dropPartial = useCallback((chatId: string) => {
    buffers.current.delete(chatId);
    revealed.current.delete(chatId);
    setPartial((prev) => {
      if (!(chatId in prev)) return prev;
      const { [chatId]: _omit, ...rest } = prev;
      return rest;
    });
  }, []);

  const commitBufferAndFinish = useCallback(
    (chatId: string, commitEvenIfEmpty: boolean) => {
      const finalText = buffers.current.get(chatId) ?? "";
      if (commitEvenIfEmpty || finalText !== "") onCompleteRef.current(chatId, finalText);
      dropPartial(chatId);
      setStreaming((s) => ({ ...s, [chatId]: false }));
    },
    [dropPartial, onCompleteRef],
  );

  useEffect(() => {
    const ids = streamIds.current;
    const offDelta = onEvent("llm-delta", ({ chatId, streamId, delta }) => {
      if (!isCurrentStream(chatId, streamId)) return;
      buffers.current.set(chatId, (buffers.current.get(chatId) ?? "") + delta);
      ensureRevealLoop();
    });
    const offDone = onEvent("llm-done", ({ chatId, streamId }) => {
      if (!isCurrentStream(chatId, streamId)) return;
      ids.delete(chatId);
      active.current.delete(chatId);
      commitBufferAndFinish(chatId, true);
    });
    const offUsage = onEvent("llm-usage", ({ chatId, streamId, inputTokens }) => {
      if (!isCurrentStream(chatId, streamId)) return;
      onUsageRef.current(chatId, inputTokens);
    });
    const offError = onEvent("llm-error", ({ chatId, streamId, code, message }) => {
      if (!isCurrentStream(chatId, streamId)) return;
      ids.delete(chatId);
      active.current.delete(chatId);
      commitBufferAndFinish(chatId, false);
      setError((e) => ({ ...e, [chatId]: { code, message } }));
    });
    return () => {
      offDelta();
      offDone();
      offUsage();
      offError();
      cancelAnimationFrame(raf.current);
      running.current = false;
      lastFrameTs.current = 0;
      ids.clear();
    };
  }, [ensureRevealLoop, commitBufferAndFinish, isCurrentStream, onUsageRef]);

  const beginStream = useCallback(
    (chatId: string, streamId: string) => {
      streamIds.current.set(chatId, streamId);
      buffers.current.set(chatId, "");
      revealed.current.set(chatId, 0);
      active.current.add(chatId);
      setPartial((p) => ({ ...p, [chatId]: "" }));
      setStreaming((s) => ({ ...s, [chatId]: true }));
      setStartedAt((s) => ({ ...s, [chatId]: Date.now() }));
      setError((e) => ({ ...e, [chatId]: null }));
      ensureRevealLoop();
    },
    [ensureRevealLoop],
  );

  const failStream = useCallback(
    (chatId: string, message: AppError) => {
      streamIds.current.delete(chatId);
      active.current.delete(chatId);
      dropPartial(chatId);
      setStreaming((s) => ({ ...s, [chatId]: false }));
      setError((err) => ({ ...err, [chatId]: message }));
      notifyAppError(message);
    },
    [dropPartial],
  );

  const isStreaming = useCallback((chatId: string) => active.current.has(chatId), []);

  const send = useCallback(
    async (
      chatId: string,
      messages: ChatMessageDto[],
      system: string,
      model: string,
      options: RequestOptions,
    ) => {
      if (active.current.has(chatId)) return;
      const streamId = crypto.randomUUID();
      beginStream(chatId, streamId);
      try {
        await sendToClaude(messages, chatId, streamId, system, model, options);
      } catch (e) {
        failStream(chatId, internalError(String(e)));
      }
    },
    [beginStream, failStream],
  );

  /** Снимает стрим с учёта и отменяет его в Rust; что делать с буфером — решает вызывающий. */
  const detach = useCallback((chatId: string): boolean => {
    const streamId = streamIds.current.get(chatId);
    if (streamId === undefined) return false;
    streamIds.current.delete(chatId);
    active.current.delete(chatId);
    void cancelStream(chatId, streamId);
    return true;
  }, []);

  const stop = useCallback(
    (chatId: string) => {
      if (detach(chatId)) commitBufferAndFinish(chatId, false);
    },
    [detach, commitBufferAndFinish],
  );

  const discard = useCallback(
    (chatId: string) => {
      if (!detach(chatId)) return;
      dropPartial(chatId);
      setStreaming((s) => ({ ...s, [chatId]: false }));
    },
    [detach, dropPartial],
  );

  return { partial, streaming, startedAt, error, isStreaming, send, stop, discard };
}
