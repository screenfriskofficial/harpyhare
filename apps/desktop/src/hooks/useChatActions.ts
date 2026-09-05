import { useCallback, type RefObject } from "react";
import type { ChatsApi } from "@/hooks/useChats";
import type { ClaudeStreams } from "@/hooks/useClaudeStream";
import { t } from "@/i18n";
import { CHAT_LIMIT } from "@/lib/chats";
import { notify } from "@/lib/notify";
const UNDO_CHAT_TOAST_PREFIX = "undo-chat|";
const UNDO_HISTORY_TOAST_PREFIX = "undo-history|";

export interface ChatActions {
  createChat: () => void;
  duplicateActiveChat: () => void;
  removeChatWithUndo: (id: string) => void;
  clearHistoryWithUndo: () => void;
  removeMessage: (index: number) => void;
}

/** Действия над списком чатов с уведомлениями: лимит, закрытие и очистка с «Вернуть». */
export function useChatActions(
  chatsRef: RefObject<ChatsApi>,
  streamRef: RefObject<ClaudeStreams>,
  afterCreate: () => void,
): ChatActions {
  const atChatLimit = useCallback(() => {
    if (chatsRef.current.chats.length < CHAT_LIMIT) return false;
    notify({
      variant: "error",
      title: t("errors.chats"),
      message: t("chats.limitReached", { limit: CHAT_LIMIT }),
    });
    return true;
  }, [chatsRef]);

  const createChat = useCallback(() => {
    if (atChatLimit()) return;
    chatsRef.current.newChat();
    afterCreate();
  }, [atChatLimit, chatsRef, afterCreate]);

  const duplicateActiveChat = useCallback(() => {
    if (atChatLimit()) return;
    chatsRef.current.duplicateChat(chatsRef.current.activeId);
    afterCreate();
  }, [atChatLimit, chatsRef, afterCreate]);

  // Стрим закрываемого чата ВЫБРАСЫВАЕТСЯ, а не коммитится: `stop` синхронно
  // дописал бы частичный ответ и открыл превью для чата, которого через строку
  // уже нет, а снимок для «Вернуть» его бы не содержал.
  const removeChatWithUndo = useCallback(
    (id: string) => {
      const api = chatsRef.current;
      const index = api.chats.findIndex((c) => c.id === id);
      const removed = api.chats[index];
      streamRef.current.discard(id);
      api.removeChat(id);
      if (!removed) return;
      notify({
        message: t("chats.closed"),
        dedupeKey: `${UNDO_CHAT_TOAST_PREFIX}${id}`,
        action: {
          label: t("chats.undo"),
          run: () => {
            if (atChatLimit()) return;
            chatsRef.current.restoreChat(removed, index);
          },
        },
      });
    },
    [chatsRef, streamRef, atChatLimit],
  );

  const clearHistoryWithUndo = useCallback(() => {
    const api = chatsRef.current;
    const { id, messages, lastInputTokens } = api.active;
    if (messages.length === 0) return;
    api.clearMessages(id);
    notify({
      message: t("chats.historyCleared"),
      dedupeKey: `${UNDO_HISTORY_TOAST_PREFIX}${id}`,
      action: {
        label: t("chats.undo"),
        run: () => {
          chatsRef.current.restoreMessages(id, messages, lastInputTokens);
        },
      },
    });
  }, [chatsRef]);

  const removeMessage = useCallback(
    (index: number) => {
      chatsRef.current.removeMessage(chatsRef.current.activeId, index);
    },
    [chatsRef],
  );

  return {
    createChat,
    duplicateActiveChat,
    removeChatWithUndo,
    clearHistoryWithUndo,
    removeMessage,
  };
}
