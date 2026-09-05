import type { ChatMessage } from "./chats";

/**
 * Стабильный React-ключ сообщения без поля `id` в модели и на диске.
 *
 * Сообщения неизменяемы: `useChats` дописывает, режет и фильтрует массив,
 * но сам объект сообщения живёт одним экземпляром от создания до удаления.
 * Ключ по индексу переносил бы локальное состояние соседа (режим переноса
 * строк и «Скопировано» у блока кода) на другое сообщение при удалении.
 */
const keys = new WeakMap<ChatMessage, string>();

export function messageKey(message: ChatMessage): string {
  const known = keys.get(message);
  if (known !== undefined) return known;
  const fresh = crypto.randomUUID();
  keys.set(message, fresh);
  return fresh;
}
