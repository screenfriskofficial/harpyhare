import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { onEvent } from "@/ipc/events";
import { lastMessageOf } from "@/lib/chat-messages";
import type { ChatMessage } from "@/lib/chats";
import { toReadingText } from "@/lib/teleprompter";
import { useLatestRef } from "./useLatestRef";

export interface TeleprompterSession {
  open: boolean;
  /** Есть что читать: идёт стрим или в чате уже есть ответ. */
  canTeleprompt: boolean;
  /** Текст для чтения: стримовый `partial`, а без него — последний ответ. */
  text: string;
  /** Смещение, с которого продолжить, если включён `teleprompter_resume` и текст тот же. */
  initialOffset: number;
  show: () => void;
  close: () => void;
  /** Запоминает позицию для возобновления и отдаёт наружу параметры для персиста. */
  persist: (speed: number, fontSize: number, offset: number) => void;
}

export function useTeleprompterSession(
  messages: ChatMessage[],
  partial: string | null,
  resumeEnabled: boolean,
  /** Хоткей открытия молчит, пока поле промпта недоступно: оверлей сети, мини-режим, заметки. */
  blockedRef: RefObject<boolean>,
  onPersistSettings: (speed: number, fontSize: number) => void,
): TeleprompterSession {
  const [open, setOpen] = useState(false);
  const resumeRef = useRef({ text: "", offset: 0 });
  const onPersistSettingsRef = useLatestRef(onPersistSettings);

  const streamText = partial !== null && partial !== "" ? partial : null;
  const lastAnswer = useMemo(() => lastMessageOf(messages, "assistant")?.text ?? null, [messages]);
  const canTeleprompt = streamText !== null || lastAnswer !== null;
  const canTelepromptRef = useLatestRef(canTeleprompt);

  // Проза считается только при открытом суфлёре: на каждый кадр стрима она не нужна.
  const text = useMemo(
    () => (open ? toReadingText(streamText ?? lastAnswer ?? "") : ""),
    [open, streamText, lastAnswer],
  );
  const textRef = useLatestRef(text);

  useEffect(
    () =>
      onEvent("toggle-teleprompter", () => {
        setOpen((current) => {
          if (current) return false;
          if (blockedRef.current || !canTelepromptRef.current) return current;
          return true;
        });
      }),
    [blockedRef, canTelepromptRef],
  );

  const show = useCallback(() => {
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
  }, []);

  const persist = useCallback(
    (speed: number, fontSize: number, offset: number) => {
      resumeRef.current = { text: textRef.current, offset };
      onPersistSettingsRef.current(speed, fontSize);
    },
    [textRef, onPersistSettingsRef],
  );

  const initialOffset =
    resumeEnabled && resumeRef.current.text === text ? resumeRef.current.offset : 0;

  return { open, canTeleprompt, text, initialOffset, show, close, persist };
}
