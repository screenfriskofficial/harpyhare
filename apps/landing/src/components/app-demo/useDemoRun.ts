import { useCallback, useEffect, useRef, useState } from "react";
import type { DemoCopy, FollowUps, QuickActionId, VoicePrompt } from "@/i18n/demo-types";
import type { DemoChat, DemoChatParams, DemoMessage } from "./types";

/** Что делает запись: HUD показывает это орбом, мини-режим — подписью. */
export type RecorderPhase = "idle" | "recording" | "transcribing";

const RECORDING_MS = 1500;
const TRANSCRIBING_MS = 750;
const AUTOSEND_DELAY_MS = 450;
const THINKING_MS = 900;
const REVEAL_CHARS_PER_SECOND = 95;
const MAX_FRAME_MS = 100;
const CHAT_LIMIT = 6;
const DEFAULT_MODEL = "claude-haiku-4-5";
const NO_PRESET = "";

const DEFAULT_PARAMS: DemoChatParams = {
  model: DEFAULT_MODEL,
  presetId: NO_PRESET,
  thinking: false,
  webSearch: false,
  context: "",
  libraryDocIds: [],
};

function freshChats(copy: DemoCopy): DemoChat[] {
  return copy.chats.map((chat, index) => ({
    ...DEFAULT_PARAMS,
    // Первые два чата — с препромптом и материалами, как у живого пользователя.
    presetId: index === 0 ? "1" : index === 1 ? "2" : NO_PRESET,
    libraryDocIds: index === 0 ? ["d4"] : index === 1 ? ["d1", "d3"] : [],
    ...chat,
    messages: [...chat.messages],
    draft: "",
  }));
}

interface Stream {
  chatId: string;
  full: string;
  shown: number;
  last: number;
}

export interface DemoStreamState {
  chatId: string;
  partial: string;
  startedAt: number;
}

export interface DemoRun {
  chats: DemoChat[];
  active: DemoChat;
  activeId: string;
  recorder: RecorderPhase;
  /** Идущий ответ; текст пуст, пока модель «думает». */
  stream: DemoStreamState | null;
  /** Чаты с ответом, который пришёл, пока вкладка была не активна. */
  unread: Record<string, boolean>;
  selectChat: (id: string) => void;
  newChat: () => void;
  duplicateChat: () => void;
  closeChat: (id: string) => void;
  setDraft: (text: string) => void;
  patchParams: (patch: Partial<DemoChatParams>) => void;
  removeMessage: (index: number) => void;
  resendFrom: (index: number) => void;
  clearHistory: () => void;
  send: () => void;
  runQuickAction: (id: QuickActionId) => void;
  stopStream: () => void;
  askByVoice: (prompt: VoicePrompt) => void;
}

export function useDemoRun(copy: DemoCopy): DemoRun {
  const [chats, setChats] = useState<DemoChat[]>(() => freshChats(copy));
  const [activeId, setActiveId] = useState(() => copy.chats[0]?.id ?? "");
  const [recorder, setRecorder] = useState<RecorderPhase>("idle");
  const [stream, setStream] = useState<DemoStreamState | null>(null);
  const [unread, setUnread] = useState<Record<string, boolean>>({});

  const timersRef = useRef<number[]>([]);
  const frameRef = useRef(0);
  const streamRef = useRef<Stream | null>(null);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  const chatSeqRef = useRef(copy.chats.length);
  const copyRef = useRef(copy);
  copyRef.current = copy;

  const cancelPending = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    cancelAnimationFrame(frameRef.current);
    streamRef.current = null;
  }, []);

  const later = useCallback((delayMs: number, run: () => void) => {
    timersRef.current.push(window.setTimeout(run, delayMs));
  }, []);

  const patchChat = useCallback((id: string, patch: (chat: DemoChat) => DemoChat) => {
    setChats((prev) => prev.map((chat) => (chat.id === id ? patch(chat) : chat)));
  }, []);

  const appendMessage = useCallback(
    (id: string, message: DemoMessage) => {
      patchChat(id, (chat) => ({ ...chat, messages: [...chat.messages, message] }));
    },
    [patchChat],
  );

  const finishStream = useCallback(
    (chatId: string, text: string) => {
      streamRef.current = null;
      setStream(null);
      if (text !== "") appendMessage(chatId, { role: "assistant", text });
      if (chatId !== activeIdRef.current) setUnread((prev) => ({ ...prev, [chatId]: true }));
    },
    [appendMessage],
  );

  const tick: (now: number) => void = useCallback(
    (now: number) => {
      const current = streamRef.current;
      if (!current) return;
      const elapsed = Math.min(MAX_FRAME_MS, now - current.last);
      current.last = now;
      current.shown += (elapsed / 1000) * REVEAL_CHARS_PER_SECOND;
      const shownChars = Math.floor(current.shown);
      if (shownChars >= current.full.length) {
        finishStream(current.chatId, current.full);
        return;
      }
      setStream((prev) =>
        prev === null ? prev : { ...prev, partial: current.full.slice(0, shownChars) },
      );
      frameRef.current = requestAnimationFrame(tick);
    },
    [finishStream],
  );

  const beginStream = useCallback(
    (chatId: string, answer: string) => {
      setStream({ chatId, partial: "", startedAt: Date.now() });
      later(THINKING_MS, () => {
        streamRef.current = { chatId, full: answer, shown: 0, last: performance.now() };
        frameRef.current = requestAnimationFrame(tick);
      });
    },
    [later, tick],
  );

  const promptFor = useCallback((question: string): VoicePrompt | null => {
    return copyRef.current.prompts.find((p) => p.question === question) ?? null;
  }, []);

  /** Отправка вопроса: сообщение в историю, черновик чистится, ответ стримится. */
  const dispatch = useCallback(
    (chatId: string, text: string, answer: string, followUps: FollowUps | null) => {
      const trimmed = text.trim();
      if (trimmed === "") return;
      cancelPending();
      appendMessage(chatId, { role: "user", text: trimmed });
      patchChat(chatId, (chat) => ({ ...chat, draft: "", followUps }));
      beginStream(chatId, answer);
    },
    [cancelPending, appendMessage, patchChat, beginStream],
  );

  const send = useCallback(() => {
    const chatId = activeIdRef.current;
    const chat = chatsRef.current.find((c) => c.id === chatId);
    if (!chat || streamRef.current?.chatId === chatId) return;
    const prompt = promptFor(chat.draft.trim());
    dispatch(
      chatId,
      chat.draft,
      prompt?.answer ?? copyRef.current.fallbackAnswer,
      prompt?.followUps ?? null,
    );
  }, [dispatch, promptFor]);

  const runQuickAction = useCallback(
    (id: QuickActionId) => {
      const chatId = activeIdRef.current;
      const chat = chatsRef.current.find((c) => c.id === chatId);
      const action = copyRef.current.hud.quickActions.find((a) => a.id === id);
      if (!chat || !action || streamRef.current?.chatId === chatId) return;
      // Быстрое действие не трогает черновик — недописанный вопрос обязан пережить ⌘1.
      cancelPending();
      appendMessage(chatId, { role: "user", text: action.prompt });
      beginStream(chatId, chat.followUps?.[id] ?? copyRef.current.fallbackAnswer);
    },
    [cancelPending, appendMessage, beginStream],
  );

  const askByVoice = useCallback(
    (prompt: VoicePrompt) => {
      const chatId = activeIdRef.current;
      cancelPending();
      setStream(null);
      setRecorder("recording");
      patchChat(chatId, (chat) => ({ ...chat, draft: "" }));
      later(RECORDING_MS, () => {
        setRecorder("transcribing");
        later(TRANSCRIBING_MS, () => {
          setRecorder("idle");
          patchChat(chatId, (chat) => ({ ...chat, draft: prompt.question }));
          later(AUTOSEND_DELAY_MS, () => {
            dispatch(chatId, prompt.question, prompt.answer, prompt.followUps);
          });
        });
      });
    },
    [cancelPending, later, patchChat, dispatch],
  );

  /** «Стоп» сохраняет уже показанную часть ответа, как в приложении. */
  const stopStream = useCallback(() => {
    const current = streamRef.current;
    cancelPending();
    if (current) finishStream(current.chatId, current.full.slice(0, Math.floor(current.shown)));
    else setStream(null);
  }, [cancelPending, finishStream]);

  const selectChat = useCallback((id: string) => {
    setActiveId(id);
    setUnread((prev) => (prev[id] ? { ...prev, [id]: false } : prev));
  }, []);

  const addChat = useCallback((params: DemoChatParams) => {
    if (chatsRef.current.length >= CHAT_LIMIT) return;
    chatSeqRef.current += 1;
    const id = `chat-${chatSeqRef.current}`;
    setChats((prev) => [
      ...prev,
      {
        ...params,
        id,
        title: copyRef.current.newChatTitle,
        messages: [],
        draft: "",
        followUps: null,
      },
    ]);
    setActiveId(id);
  }, []);

  const newChat = useCallback(() => {
    addChat(DEFAULT_PARAMS);
  }, [addChat]);

  /** Дубликат: те же параметры и материалы, без сообщений. */
  const duplicateChat = useCallback(() => {
    const source = chatsRef.current.find((c) => c.id === activeIdRef.current);
    if (!source) return;
    addChat({
      model: source.model,
      presetId: source.presetId,
      thinking: source.thinking,
      webSearch: source.webSearch,
      context: source.context,
      libraryDocIds: [...source.libraryDocIds],
    });
  }, [addChat]);

  const closeChat = useCallback(
    (id: string) => {
      const current = chatsRef.current;
      if (current.length <= 1) return;
      if (streamRef.current?.chatId === id) {
        cancelPending();
        setStream(null);
      }
      const rest = current.filter((chat) => chat.id !== id);
      setChats(rest);
      const fallback = rest[0];
      if (fallback && id === activeIdRef.current) setActiveId(fallback.id);
    },
    [cancelPending],
  );

  const setDraft = useCallback(
    (text: string) => {
      patchChat(activeIdRef.current, (chat) => ({ ...chat, draft: text }));
    },
    [patchChat],
  );

  const patchParams = useCallback(
    (patch: Partial<DemoChatParams>) => {
      patchChat(activeIdRef.current, (chat) => ({ ...chat, ...patch }));
    },
    [patchChat],
  );

  const removeMessage = useCallback(
    (index: number) => {
      patchChat(activeIdRef.current, (chat) => ({
        ...chat,
        messages: chat.messages.filter((_, i) => i !== index),
      }));
    },
    [patchChat],
  );

  /** Переотправка: всё ниже сообщения заменяется новым ответом. */
  const resendFrom = useCallback(
    (index: number) => {
      const chatId = activeIdRef.current;
      const chat = chatsRef.current.find((c) => c.id === chatId);
      if (!chat || streamRef.current?.chatId === chatId) return;
      const message = chat.messages[index];
      if (message?.role !== "user") return;
      cancelPending();
      patchChat(chatId, (c) => ({ ...c, messages: c.messages.slice(0, index + 1) }));
      const prompt = promptFor(message.text);
      const quick = copyRef.current.hud.quickActions.find((a) => a.prompt === message.text);
      const quickAnswer = quick ? (chat.followUps?.[quick.id] ?? null) : null;
      const answer = prompt?.answer ?? quickAnswer ?? copyRef.current.fallbackAnswer;
      beginStream(chatId, answer);
    },
    [cancelPending, patchChat, promptFor, beginStream],
  );

  const clearHistory = useCallback(() => {
    const chatId = activeIdRef.current;
    if (streamRef.current?.chatId === chatId) {
      cancelPending();
      setStream(null);
    }
    patchChat(chatId, (chat) => ({ ...chat, messages: [], followUps: null }));
  }, [cancelPending, patchChat]);

  useEffect(() => cancelPending, [cancelPending]);

  const active = chats.find((chat) => chat.id === activeId) ?? chats[0];

  return {
    chats,
    active: active ?? {
      ...DEFAULT_PARAMS,
      id: "",
      title: "",
      messages: [],
      draft: "",
      followUps: null,
    },
    activeId,
    recorder,
    stream,
    unread,
    selectChat,
    newChat,
    duplicateChat,
    closeChat,
    setDraft,
    patchParams,
    removeMessage,
    resendFrom,
    clearHistory,
    send,
    runQuickAction,
    stopStream,
    askByVoice,
  };
}
