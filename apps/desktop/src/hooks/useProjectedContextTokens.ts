import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { countChatTokens } from "@/ipc/commands";
import type { ChatMessageDto } from "@/ipc/types";
import { toMessageDto } from "@/lib/chat-messages";
import { chatRequestOptions, type Chat } from "@/lib/chats";
import { textDigest } from "@/lib/digest";
import { queryKeys } from "@/lib/query-client";

const TOKEN_COUNT_PLACEHOLDER_MESSAGE: ChatMessageDto = { role: "user", text: ".", images: [] };
const PROJECTED_TOKENS_STALE_MS = 10 * 60 * 1000;
const MESSAGES_KEY_FIELD_SEPARATOR = ":";
const MESSAGES_KEY_SEPARATOR = "|";
const CHAT_ID_KEY_INDEX = 1;

/**
 * Проекция занятости контекста через `count_tokens`. Плейсхолдер держит
 * прошлое значение ТОЛЬКО в пределах одного чата: при переключении чата
 * счётчик прошлого чата на один round-trip выглядел бы как счётчик нового, а
 * фолбэк на `lastInputTokens` как раз для этого момента и персистится.
 */
export function useProjectedContextTokens(chat: Chat, system: string, streaming: boolean): number {
  const messagesKey = useMemo(
    () =>
      chat.messages
        .map((m) => [m.role, String(m.text.length)].join(MESSAGES_KEY_FIELD_SEPARATOR))
        .join(MESSAGES_KEY_SEPARATOR),
    [chat.messages],
  );
  const systemDigest = useMemo(() => textDigest(system), [system]);
  const options = chatRequestOptions(chat);
  const { data } = useQuery({
    queryKey: queryKeys.countTokens(chat.id, chat.model, options, systemDigest, messagesKey),
    queryFn: () => {
      const history =
        chat.messages.length > 0
          ? chat.messages.map(toMessageDto)
          : [TOKEN_COUNT_PLACEHOLDER_MESSAGE];
      return countChatTokens(history, system, chat.model, options);
    },
    enabled: !streaming,
    staleTime: PROJECTED_TOKENS_STALE_MS,
    placeholderData: (prev, prevQuery) =>
      prevQuery?.queryKey[CHAT_ID_KEY_INDEX] === chat.id ? prev : undefined,
  });
  return data ?? 0;
}
