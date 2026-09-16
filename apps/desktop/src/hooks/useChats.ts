import { useCallback, useEffect, useState } from "react";
import { loadChats, saveChats } from "@/ipc/commands";
import {
  CHAT_LIMIT,
  chatTitle,
  createChat,
  createChatFrom,
  deserializeChats,
  EMPTY_CHAT,
  serializeChats,
  type Chat,
  type ChatMessage,
  type ChatPatch,
} from "@/lib/chats";
import type { ImagePayload } from "@/lib/composer";
import { CHATS_SUBJECT } from "@/lib/persist-errors";
import {
  useDraftAttachments,
  type DraftAttachmentsApi,
  type PatchChatFn,
} from "./useDraftAttachments";
import { useLatestRef } from "./useLatestRef";
import { useLoadedJsonStore } from "./useLoadedJsonStore";

const ACTIVE_CHAT_STORAGE_KEY = "active-chat-id";

function rememberedActiveId(chats: Chat[]): string {
  const stored = localStorage.getItem(ACTIVE_CHAT_STORAGE_KEY) ?? "";
  const survived = chats.some((c) => c.id === stored);
  return survived ? stored : (chats[0]?.id ?? "");
}

function useRememberActiveChat(activeId: string, loaded: boolean): void {
  useEffect(() => {
    if (!loaded || activeId === "") return;
    localStorage.setItem(ACTIVE_CHAT_STORAGE_KEY, activeId);
  }, [activeId, loaded]);
}

function chatWithUserMessage(
  chat: Chat,
  index: number,
  text: string,
  images: ImagePayload[],
): Chat {
  const isFirst = chat.messages.length === 0;
  return {
    ...chat,
    title: isFirst && !chat.titlePinned ? chatTitle(text, index + 1) : chat.title,
    messages: [...chat.messages, { role: "user", text, images }],
  };
}

function withClearedDraft(chat: Chat): Chat {
  return { ...chat, draft: "", draftAttachments: [] };
}

function withoutSentAttachments(chat: Chat, images: ImagePayload[]): Chat {
  return images.length === 0 ? chat : { ...chat, draftAttachments: [] };
}

export interface ChatsApi extends DraftAttachmentsApi {
  chats: Chat[];
  activeId: string;
  active: Chat;
  newChat: () => void;
  duplicateChat: (sourceId: string) => void;
  removeChat: (id: string) => void;
  patchChat: (id: string, patch: ChatPatch) => void;
  selectChat: (id: string) => void;
  appendUserMessage: (id: string, text: string, images: ImagePayload[]) => void;
  appendQuickActionMessage: (id: string, text: string, images: ImagePayload[]) => void;
  appendAssistantMessage: (id: string, text: string) => void;
  removeMessage: (id: string, index: number) => void;
  truncateMessages: (id: string, count: number) => void;
  clearMessages: (id: string) => void;
  restoreMessages: (id: string, messages: ChatMessage[]) => void;
  restoreChat: (chat: Chat, index: number) => void;
  flush: () => Promise<void>;
}

/**
 * `defaultModel` is a getter, not a value: it is read at the moment a chat is
 * created, so a key added mid-session immediately changes what the next chat
 * opens on. Passing the value instead would freeze the first render's answer.
 */
/** A chat opens on a model the user can actually call — see `defaultModelFor`. */
function withDefaultModel(chat: Chat, defaultModel?: () => string): Chat {
  const model = defaultModel?.();
  return model === undefined || model === "" ? chat : { ...chat, model };
}

export function useChats(defaultModel?: () => string): ChatsApi {
  const newChatModel = useLatestRef(defaultModel);
  const makeChat = useCallback(
    (index: number, id?: string) => withDefaultModel(createChat(index, id), newChatModel.current),
    [newChatModel],
  );
  const [activeId, setActiveId] = useState<string>("");
  // The HUD needs a real chat even when the file is empty or unreadable: on
  // `EMPTY_CHAT` (empty id) every send would go nowhere and every answer would
  // be appended to a chat that does not exist, with no error anywhere.
  const freshChats = useCallback(() => [makeChat(1)], [makeChat]);
  const rememberActive = useCallback((initial: Chat[]) => {
    setActiveId(rememberedActiveId(initial));
  }, []);
  const {
    value: chats,
    setValue: setChats,
    loaded,
    flush,
  } = useLoadedJsonStore<Chat[]>({
    load: loadChats,
    save: saveChats,
    deserialize: deserializeChats,
    serialize: serializeChats,
    subject: CHATS_SUBJECT,
    initial: [],
    fallback: freshChats,
    onLoaded: rememberActive,
  });
  const chatsRef = useLatestRef(chats);

  const effectiveActiveId = activeId || (chats[0]?.id ?? "");
  const activeIdRef = useLatestRef(effectiveActiveId);
  useRememberActiveChat(effectiveActiveId, loaded);

  const patch = useCallback<PatchChatFn>(
    (id, fn) => {
      setChats((prev) => prev.map((c) => (c.id === id ? fn(c) : c)));
    },
    [setChats],
  );

  const draftAttachments = useDraftAttachments(chatsRef, patch);

  // Лимит проверяется и активный чат переключается ВНУТРИ апдейтера: второй
  // вызов до ре-рендера иначе проходил бы проверку по замыканию и уводил
  // `activeId` на несозданный чат.
  //
  // A new chat inherits the active chat's preset and selected pipelines. The
  // model, context and materials stay at their defaults; the prepared prompt is
  // rebuilt too, because its sources differ in the new chat. A full copy of the
  // parameters and of the prepared snapshot is what `duplicateChat` is for.
  const newChat = useCallback(() => {
    const id = crypto.randomUUID();
    const sourceId = activeIdRef.current;
    setChats((prev) => {
      if (prev.length >= CHAT_LIMIT) return prev;
      setActiveId(id);
      const fresh = makeChat(prev.length + 1, id);
      const source = prev.find((c) => c.id === sourceId);
      return [
        ...prev,
        {
          ...fresh,
          presetId: source?.presetId ?? fresh.presetId,
          promptPipelineId: source?.promptPipelineId,
          messagePipelineId: source?.messagePipelineId,
        },
      ];
    });
  }, [makeChat, activeIdRef, setChats]);

  const duplicateChat = useCallback(
    (sourceId: string) => {
      const id = crypto.randomUUID();
      setChats((prev) => {
        if (prev.length >= CHAT_LIMIT) return prev;
        const source = prev.find((c) => c.id === sourceId);
        if (!source) return prev;
        setActiveId(id);
        return [...prev, createChatFrom(source, prev.length + 1, id)];
      });
    },
    [setChats],
  );

  const removeChat = useCallback(
    (id: string) => {
      setChats((prev) => {
        if (prev.length <= 1) return prev;
        const idx = prev.findIndex((c) => c.id === id);
        const next = prev.filter((c) => c.id !== id);
        setActiveId((cur) => {
          if (cur !== id) return cur;
          const neighbor = next[Math.min(idx, next.length - 1)];
          return neighbor ? neighbor.id : cur;
        });
        return next;
      });
    },
    [setChats],
  );

  const patchChat = useCallback(
    (id: string, fields: ChatPatch) => {
      patch(id, (c) => ({ ...c, ...fields }));
    },
    [patch],
  );

  const selectChat = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const appendUserTurn = useCallback(
    (id: string, text: string, images: ImagePayload[], afterAppend: (chat: Chat) => Chat) => {
      setChats((prev) =>
        prev.map((c, i) =>
          c.id === id ? afterAppend(chatWithUserMessage(c, i, text, images)) : c,
        ),
      );
    },
    [setChats],
  );

  const appendUserMessage = useCallback(
    (id: string, text: string, images: ImagePayload[]) => {
      appendUserTurn(id, text, images, withClearedDraft);
    },
    [appendUserTurn],
  );

  const appendQuickActionMessage = useCallback(
    (id: string, text: string, images: ImagePayload[]) => {
      appendUserTurn(id, text, images, (c) => withoutSentAttachments(c, images));
    },
    [appendUserTurn],
  );

  const appendAssistantMessage = useCallback(
    (id: string, text: string) => {
      patch(id, (c) => ({
        ...c,
        messages: [...c.messages, { role: "assistant", text, images: [] }],
      }));
    },
    [patch],
  );

  const removeMessage = useCallback(
    (id: string, index: number) => {
      patch(id, (c) => ({ ...c, messages: c.messages.filter((_, i) => i !== index) }));
    },
    [patch],
  );

  const truncateMessages = useCallback(
    (id: string, count: number) => {
      patch(id, (c) => ({ ...c, messages: c.messages.slice(0, count) }));
    },
    [patch],
  );

  const clearMessages = useCallback(
    (id: string) => {
      patch(id, (c) => ({ ...c, messages: [] }));
    },
    [patch],
  );

  const active = chats.find((c) => c.id === effectiveActiveId) ?? chats[0] ?? EMPTY_CHAT;

  const restoreMessages = useCallback(
    (id: string, messages: ChatMessage[]) => {
      patch(id, (c) => ({ ...c, messages }));
    },
    [patch],
  );

  const restoreChat = useCallback(
    (chat: Chat, index: number) => {
      setChats((prev) => {
        if (prev.length >= CHAT_LIMIT || prev.some((c) => c.id === chat.id)) return prev;
        const next = [...prev];
        next.splice(Math.min(index, next.length), 0, chat);
        setActiveId(chat.id);
        return next;
      });
    },
    [setChats],
  );

  return {
    chats,
    activeId: effectiveActiveId,
    active,
    newChat,
    duplicateChat,
    removeChat,
    patchChat,
    selectChat,
    ...draftAttachments,
    appendUserMessage,
    appendQuickActionMessage,
    appendAssistantMessage,
    removeMessage,
    truncateMessages,
    clearMessages,
    restoreMessages,
    restoreChat,
    flush,
  };
}
