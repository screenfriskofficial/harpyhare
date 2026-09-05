import type { ChatMessageDto, ImagePayload } from "@/ipc/types";
import type { Chat, ChatMessage, Role } from "./chats";

/** Сообщение в форме, которую принимает Rust: без ключей и служебных полей. */
export function toMessageDto(message: ChatMessage): ChatMessageDto {
  return { role: message.role, text: message.text, images: message.images };
}

export function historyWithNewUserMessage(
  chat: Chat,
  text: string,
  images: ImagePayload[],
): ChatMessageDto[] {
  return [...chat.messages.map(toMessageDto), { role: "user", text, images }];
}

export function draftImages(chat: Chat): ImagePayload[] {
  return chat.draftAttachments.map((a) => a.payload);
}

/** Поиск с конца без копии массива: `findLast` недоступен в целевом `lib`. */
export function lastMessageOf(messages: readonly ChatMessage[], role: Role): ChatMessage | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role === role) return message;
  }
  return null;
}

export function lastUserMessageIndex(messages: readonly ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") return i;
  }
  return -1;
}
