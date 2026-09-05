import { describe, expect, it } from "vitest";
import {
  chatTitle,
  createChat,
  createChatFrom,
  deserializeChats,
  serializeChats,
  type Chat,
} from "./chats";

const img = { media_type: "image/png", data: "AAAA" };

function chatWith(messages: Chat["messages"], extra: Partial<Chat> = {}): Chat {
  return {
    id: "x",
    title: "Чат 1",
    messages,
    draft: "",
    draftAttachments: [],
    titlePinned: false,
    presetId: "transcription",
    thinkingEnabled: true,
    model: "claude-opus-4-8",
    webSearch: false,
    context: "",
    libraryDocIds: [],
    lastInputTokens: 0,
    ...extra,
  };
}

describe("createChat", () => {
  it("даёт уникальный id и заголовок по индексу", () => {
    const a = createChat(1);
    const b = createChat(2);
    expect(a.id).not.toBe(b.id);
    expect(a.title).toBe("Чат 1");
    expect(b.title).toBe("Чат 2");
    expect(a.messages).toEqual([]);
    expect(a.draft).toBe("");
  });

  it("новые дефолты: без пресета, thinking выкл, модель haiku, веб-поиск выкл", () => {
    const c = createChat(1);
    expect(c.presetId).toBe("");
    expect(c.thinkingEnabled).toBe(false);
    expect(c.model).toBe("claude-haiku-4-5-20251001");
    expect(c.webSearch).toBe(false);
  });
});

describe("createChatFrom", () => {
  it("копирует параметры запроса и контекст, но не содержимое", () => {
    const source = chatWith([{ role: "user", text: "вопрос", images: [img] }], {
      title: "Мой чат",
      titlePinned: true,
      draft: "недописанное",
      draftAttachments: [{ payload: img, preview: "data:image/png;base64,AAAA" }],
      presetId: "golang",
      thinkingEnabled: true,
      model: "claude-opus-4-8",
      webSearch: true,
      context: "справка",
      libraryDocIds: ["a", "b"],
      lastInputTokens: 4242,
    });
    const copy = createChatFrom(source, 3);
    expect(copy.id).not.toBe(source.id);
    expect(copy.title).toBe("Чат 3");
    expect(copy.titlePinned).toBe(false);
    expect(copy.messages).toEqual([]);
    expect(copy.draft).toBe("");
    expect(copy.draftAttachments).toEqual([]);
    expect(copy.lastInputTokens).toBe(0);
    expect(copy.presetId).toBe("golang");
    expect(copy.thinkingEnabled).toBe(true);
    expect(copy.model).toBe("claude-opus-4-8");
    expect(copy.webSearch).toBe(true);
    expect(copy.context).toBe("справка");
    expect(copy.libraryDocIds).toEqual(["a", "b"]);
    expect(copy.libraryDocIds).not.toBe(source.libraryDocIds);
  });
});

describe("chatTitle", () => {
  it("берёт начало первого пользовательского сообщения", () => {
    expect(chatTitle("объясни рекурсию подробно и с примерами", 1)).toBe("объясни рекурсию подро…");
  });
  it("короткий текст не обрезает", () => {
    expect(chatTitle("привет", 1)).toBe("привет");
  });
  it("пустой текст → запасной заголовок по индексу", () => {
    expect(chatTitle("   ", 3)).toBe("Чат 3");
  });
  it("режет по кодовым точкам, не оставляя половину эмодзи", () => {
    const title = chatTitle(`${"a".repeat(21)}😀 и дальше`, 1);
    expect(title).toBe(`${"a".repeat(21)}😀…`);
    expect(title.includes("\ufffd")).toBe(false);
  });
});

describe("serialize/deserialize", () => {
  it("стрипает картинки из сообщений и черновые вложения", () => {
    const chats = [
      chatWith(
        [
          { role: "user", text: "что тут?", images: [img] },
          { role: "assistant", text: "кот", images: [] },
        ],
        { draft: "недописанное", draftAttachments: [{ payload: img, preview: "data:..." }] },
      ),
    ];
    const json = serializeChats(chats);
    const parsed = JSON.parse(json) as {
      messages: { text: string; images: unknown[] }[];
      draft: string;
      draftAttachments: unknown[];
    }[];
    expect(parsed[0]?.messages[0]?.images).toEqual([]);
    expect(parsed[0]?.messages[0]?.text).toBe("что тут?");
    expect(parsed[0]?.draft).toBe("недописанное");
    expect(parsed[0]?.draftAttachments).toEqual([]);
  });

  it("round-trip восстанавливает чаты с пустыми вложениями", () => {
    const chats = [chatWith([{ role: "user", text: "вопрос", images: [] }], { draft: "хвост" })];
    const restored = deserializeChats(serializeChats(chats));
    expect(restored).not.toBeNull();
    expect(restored?.[0]?.messages[0]?.text).toBe("вопрос");
    expect(restored?.[0]?.draft).toBe("хвост");
    expect(restored?.[0]?.draftAttachments).toEqual([]);
  });

  it("пустая строка → null", () => {
    expect(deserializeChats("")).toBeNull();
  });

  it("битый JSON → null", () => {
    expect(deserializeChats("{не json")).toBeNull();
  });

  it("пустой массив → null (фронт создаст стартовый чат)", () => {
    expect(deserializeChats("[]")).toBeNull();
  });

  it("null вместо чата или сообщения пропускается, а не роняет загрузку", () => {
    expect(deserializeChats("[null]")).toBeNull();
    expect(deserializeChats("null")).toBeNull();
    const restored = deserializeChats(
      '[null, {"id":"a","messages":[null, {"role":"user","text":"x"}]}]',
    );
    expect(restored?.length).toBe(1);
    expect(restored?.[0]?.messages).toEqual([{ role: "user", text: "x", images: [] }]);
  });

  it("сохраняет titlePinned при round-trip", () => {
    const chats = [chatWith([], { title: "Моё имя", titlePinned: true })];
    const restored = deserializeChats(serializeChats(chats));
    expect(restored?.[0]?.title).toBe("Моё имя");
    expect(restored?.[0]?.titlePinned).toBe(true);
  });

  it("старый json без titlePinned → titlePinned=false", () => {
    const restored = deserializeChats('[{"id":"a","title":"Чат 1","messages":[],"draft":""}]');
    expect(restored?.[0]?.titlePinned).toBe(false);
  });

  it("сохраняет presetId при round-trip; старый json без него → ''", () => {
    const chats = [chatWith([], { presetId: "abc" })];
    expect(deserializeChats(serializeChats(chats))?.[0]?.presetId).toBe("abc");
    const old = deserializeChats('[{"id":"a","title":"Чат 1","messages":[],"draft":""}]');
    expect(old?.[0]?.presetId).toBe("");
  });

  it("сохраняет thinkingEnabled при round-trip; старый json без него → false", () => {
    const chats = [chatWith([], { thinkingEnabled: true })];
    expect(deserializeChats(serializeChats(chats))?.[0]?.thinkingEnabled).toBe(true);
    const old = deserializeChats('[{"id":"a","title":"Чат 1","messages":[],"draft":""}]');
    expect(old?.[0]?.thinkingEnabled).toBe(false);
  });

  it("сохраняет model при round-trip; старый json без него → дефолтная модель", () => {
    const chats = [chatWith([], { model: "claude-opus-4-8" })];
    expect(deserializeChats(serializeChats(chats))?.[0]?.model).toBe("claude-opus-4-8");
    const old = deserializeChats('[{"id":"a","title":"Чат 1","messages":[],"draft":""}]');
    expect(old?.[0]?.model).toBe("claude-haiku-4-5-20251001");
  });

  it("сохраняет webSearch при round-trip; старый json без него → false", () => {
    const chats = [chatWith([], { webSearch: true })];
    expect(deserializeChats(serializeChats(chats))?.[0]?.webSearch).toBe(true);
    const old = deserializeChats('[{"id":"a","title":"Чат 1","messages":[],"draft":""}]');
    expect(old?.[0]?.webSearch).toBe(false);
  });

  it("сохраняет context при round-trip (текст переживает диск); старый json → ''", () => {
    const chats = [chatWith([], { context: "вакансия: senior rust" })];
    expect(deserializeChats(serializeChats(chats))?.[0]?.context).toBe("вакансия: senior rust");
    const old = deserializeChats('[{"id":"a","title":"Чат 1","messages":[],"draft":""}]');
    expect(old?.[0]?.context).toBe("");
  });
});
