import { describe, expect, it } from "vitest";
import {
  draftImages,
  historyWithNewUserMessage,
  lastMessageOf,
  lastUserMessageIndex,
  toMessageDto,
} from "./chat-messages";
import { createChat, type ChatMessage } from "./chats";

const user = (text: string): ChatMessage => ({ role: "user", text, images: [] });
const assistant = (text: string): ChatMessage => ({ role: "assistant", text, images: [] });

describe("lastMessageOf / lastUserMessageIndex", () => {
  const history = [user("q1"), assistant("a1"), user("q2")];

  it("находят последнее сообщение роли с конца", () => {
    expect(lastMessageOf(history, "assistant")?.text).toBe("a1");
    expect(lastMessageOf(history, "user")?.text).toBe("q2");
    expect(lastUserMessageIndex(history)).toBe(2);
  });

  it("без сообщений роли — null / −1", () => {
    expect(lastMessageOf([assistant("a")], "user")).toBeNull();
    expect(lastUserMessageIndex([assistant("a")])).toBe(-1);
  });
});

describe("historyWithNewUserMessage", () => {
  it("дописывает новый вопрос к DTO истории", () => {
    const chat = { ...createChat(1, "c"), messages: [user("q1"), assistant("a1")] };
    const image = { media_type: "image/png", data: "AAAA" };
    expect(historyWithNewUserMessage(chat, "q2", [image])).toEqual([
      toMessageDto(user("q1")),
      toMessageDto(assistant("a1")),
      { role: "user", text: "q2", images: [image] },
    ]);
  });
});

describe("draftImages", () => {
  it("отдаёт полезную нагрузку вложений черновика", () => {
    const payload = { media_type: "image/png", data: "AAAA" };
    const chat = { ...createChat(1, "c"), draftAttachments: [{ payload, preview: "p" }] };
    expect(draftImages(chat)).toEqual([payload]);
  });
});
