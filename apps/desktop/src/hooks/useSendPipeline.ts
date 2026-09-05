import { useCallback, type RefObject } from "react";
import type { ChatsApi } from "@/hooks/useChats";
import type { ClaudeStreams } from "@/hooks/useClaudeStream";
import type { ChatMessageDto } from "@/ipc/types";
import { draftImages, historyWithNewUserMessage, toMessageDto } from "@/lib/chat-messages";
import { chatRequestOptions, type Chat } from "@/lib/chats";
import type { ContextLibrary } from "@/lib/context-library";
import type { PromptPreset } from "@/lib/presets";
import { chatPromptSources, chatSystemPrompt } from "@/lib/system-prompt";

export interface SendPipeline {
  dispatchSend: (rawText: string) => void;
  dispatchQuickAction: (prompt: string, withAttachments: boolean) => void;
  doSend: () => void;
  resendFromMessage: (index: number) => void;
}

/**
 * Все пути отправки (обычная, быстрое действие, переотправка) делят одну
 * сборку system + истории и один запуск стрима. Гейт «чат уже стримит» —
 * синхронный `isStreaming` из хука стрима, а не state-флаг: два вызова в
 * одном тике иначе проходили бы оба.
 */
export function useSendPipeline(
  chatsRef: RefObject<ChatsApi>,
  streamRef: RefObject<ClaudeStreams>,
  presetsRef: RefObject<PromptPreset[]>,
  libraryRef: RefObject<ContextLibrary>,
  beforeSend: () => void,
): SendPipeline {
  const streamChat = useCallback(
    (chat: Chat, history: ChatMessageDto[]) => {
      const system = chatSystemPrompt(
        chatPromptSources(presetsRef.current, chat, libraryRef.current),
      );
      void streamRef.current.send(chat.id, history, system, chat.model, chatRequestOptions(chat));
    },
    [streamRef, presetsRef, libraryRef],
  );

  const dispatchSend = useCallback(
    (rawText: string) => {
      const chat = chatsRef.current.active;
      if (streamRef.current.isStreaming(chat.id)) return;
      const trimmed = rawText.trim();
      const images = draftImages(chat);
      if (trimmed === "" && images.length === 0) return;
      beforeSend();
      chatsRef.current.appendUserMessage(chat.id, trimmed, images);
      streamChat(chat, historyWithNewUserMessage(chat, trimmed, images));
    },
    [chatsRef, streamRef, beforeSend, streamChat],
  );

  const dispatchQuickAction = useCallback(
    (prompt: string, withAttachments: boolean) => {
      const chat = chatsRef.current.active;
      if (streamRef.current.isStreaming(chat.id)) return;
      const trimmed = prompt.trim();
      if (trimmed === "") return;
      const images = withAttachments ? draftImages(chat) : [];
      beforeSend();
      chatsRef.current.appendQuickActionMessage(chat.id, trimmed, images);
      streamChat(chat, historyWithNewUserMessage(chat, trimmed, images));
    },
    [chatsRef, streamRef, beforeSend, streamChat],
  );

  const doSend = useCallback(() => {
    dispatchSend(chatsRef.current.active.draft);
  }, [dispatchSend, chatsRef]);

  const resendFromMessage = useCallback(
    (index: number) => {
      const chat = chatsRef.current.active;
      if (streamRef.current.isStreaming(chat.id)) return;
      if (chat.messages[index]?.role !== "user") return;
      beforeSend();
      const kept = chat.messages.slice(0, index + 1);
      chatsRef.current.truncateMessages(chat.id, kept.length);
      streamChat(chat, kept.map(toMessageDto));
    },
    [chatsRef, streamRef, beforeSend, streamChat],
  );

  return { dispatchSend, dispatchQuickAction, doSend, resendFromMessage };
}
