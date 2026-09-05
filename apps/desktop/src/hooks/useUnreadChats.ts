import { useCallback, useEffect, useState } from "react";
import type { Chat } from "@/lib/chats";

export interface UnreadChats {
  unread: Record<string, boolean>;
  /** Есть ли непрочитанный ответ хотя бы в одном ЖИВОМ чате. */
  unreadAnswer: boolean;
  markUnread: (chatId: string) => void;
}

/**
 * Ответ считается непрочитанным, если пришёл не в активный чат либо пока
 * окно свёрнуто или открыт режим заметок. Прочитанность снимается, когда чат
 * снова виден. Id закрытых чатов в карте безвредны: сводный флаг фильтрует по живым.
 */
export function useUnreadChats(chats: Chat[], activeId: string, hidden: boolean): UnreadChats {
  const [unread, setUnread] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (hidden) return;
    setUnread((prev) => (prev[activeId] ? { ...prev, [activeId]: false } : prev));
  }, [activeId, hidden]);

  const markUnread = useCallback((chatId: string) => {
    setUnread((prev) => ({ ...prev, [chatId]: true }));
  }, []);

  const unreadAnswer = chats.some((c) => unread[c.id]);

  return { unread, unreadAnswer, markUnread };
}
