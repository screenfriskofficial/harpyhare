import { describe, expect, it } from "vitest";
import {
  chatTitle,
  createChat,
  createChatFrom,
  deserializeChats,
  serializeChats,
  type Chat,
  type PreparedPrompt,
} from "./chats";

const img = { media_type: "image/png", data: "AAAA" };
const preparedPrompt: PreparedPrompt = {
  pipelineId: "prepare-interview",
  fingerprint: "source-revision-1",
  text: "Подготовленный системный промпт\nс материалами",
  keywordSources: ["[keywords]: [Kafka, Rust]", "материал кандидата"],
};

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
  it("сохраняет выбранные схемы и готовый снимок без истории и черновика", () => {
    const source = chatWith([{ role: "user", text: "прошлый вопрос", images: [] }], {
      draft: "черновик",
      promptPipelineId: preparedPrompt.pipelineId,
      messagePipelineId: "answer-and-polish",
      preparedPrompt,
    });
    const copy = createChatFrom(source, 2);
    expect(copy.promptPipelineId).toBe(preparedPrompt.pipelineId);
    expect(copy.messagePipelineId).toBe("answer-and-polish");
    expect(copy.preparedPrompt).toEqual(preparedPrompt);
    expect(copy.messages).toEqual([]);
    expect(copy.draft).toBe("");
    source.preparedPrompt = { ...preparedPrompt, text: "новая подготовка исходного чата" };
    expect(copy.preparedPrompt?.text).toBe(preparedPrompt.text);
  });

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
    });
    const copy = createChatFrom(source, 3);
    expect(copy.id).not.toBe(source.id);
    expect(copy.title).toBe("Чат 3");
    expect(copy.titlePinned).toBe(false);
    expect(copy.messages).toEqual([]);
    expect(copy.draft).toBe("");
    expect(copy.draftAttachments).toEqual([]);
    expect(copy.presetId).toBe("golang");
    expect(copy.thinkingEnabled).toBe(true);
    expect(copy.model).toBe("claude-opus-4-8");
    expect(copy.webSearch).toBe(true);
    expect(copy.context).toBe("справка");
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
  it("сохраняет обе схемы и подготовленный снимок с fingerprint и терминами", () => {
    const chat = chatWith([{ role: "user", text: "вопрос", images: [] }], {
      promptPipelineId: preparedPrompt.pipelineId,
      messagePipelineId: "answer-and-polish",
      preparedPrompt,
    });
    const json = serializeChats([chat]);
    const disk: unknown = JSON.parse(json);
    expect(Array.isArray(disk)).toBe(true);
    const restored = deserializeChats(json)?.[0];
    expect(restored?.promptPipelineId).toBe(preparedPrompt.pipelineId);
    expect(restored?.messagePipelineId).toBe("answer-and-polish");
    expect(restored?.preparedPrompt).toEqual(preparedPrompt);
    expect(restored?.preparedPrompt).not.toBe(preparedPrompt);
    expect(restored?.messages).toEqual(chat.messages);
  });

  it("старые чаты сохраняют прежние источники без автоматического выбора схем", () => {
    const restored = deserializeChats(
      JSON.stringify([
        {
          id: "legacy",
          presetId: "golang",
          context: "свой контекст",
          messages: [{ role: "assistant", text: "старый ответ", images: [] }],
        },
      ]),
    )?.[0];
    expect(restored?.promptPipelineId).toBeUndefined();
    expect(restored?.messagePipelineId).toBeUndefined();
    expect(restored?.preparedPrompt).toBeUndefined();
    expect(restored?.presetId).toBe("golang");
    expect(restored?.context).toBe("свой контекст");
    expect(restored?.messages[0]?.text).toBe("старый ответ");
    const saved: unknown = JSON.parse(serializeChats(restored ? [restored] : []));
    expect(saved).not.toHaveProperty("0.promptPipelineId");
    expect(saved).not.toHaveProperty("0.messagePipelineId");
    expect(saved).not.toHaveProperty("0.preparedPrompt");
  });

  it("невалидные типы выбранных схем не становятся рабочими ссылками", () => {
    const restored = deserializeChats(
      JSON.stringify([
        {
          id: "chat",
          promptPipelineId: 42,
          messagePipelineId: { id: "wrong" },
        },
      ]),
    )?.[0];
    expect(restored?.promptPipelineId).toBeUndefined();
    expect(restored?.messagePipelineId).toBeUndefined();
  });

  it("пустой id схемы читается как «без схемы», а не как ссылка на пустую строку", () => {
    const restored = deserializeChats(
      JSON.stringify([{ id: "chat", promptPipelineId: "", messagePipelineId: "" }]),
    )?.[0];
    expect(restored?.promptPipelineId).toBeUndefined();
    expect(restored?.messagePipelineId).toBeUndefined();
  });

  it.each([
    { name: "null", value: null },
    { name: "массив", value: [] },
    { name: "текст вместо объекта", value: "prepared" },
    { name: "нет pipelineId", value: { fingerprint: "f", text: "t", keywordSources: [] } },
    { name: "нет fingerprint", value: { pipelineId: "p", text: "t", keywordSources: [] } },
    { name: "нет текста", value: { pipelineId: "p", fingerprint: "f", keywordSources: [] } },
    { name: "неверный тип текста", value: { ...preparedPrompt, text: 42 } },
    { name: "термины не массив", value: { ...preparedPrompt, keywordSources: "Rust" } },
  ])("отбрасывает повреждённый артефакт ($name), сохраняя чат и выбор схемы", ({ value }) => {
    const restored = deserializeChats(
      JSON.stringify([
        {
          id: "chat",
          promptPipelineId: preparedPrompt.pipelineId,
          preparedPrompt: value,
          messages: [{ role: "user", text: "история остаётся", images: [] }],
        },
      ]),
    )?.[0];
    expect(restored?.preparedPrompt).toBeUndefined();
    expect(restored?.promptPipelineId).toBe(preparedPrompt.pipelineId);
    expect(restored?.messages[0]?.text).toBe("история остаётся");
  });

  it("в терминах артефакта оставляет только строковые источники", () => {
    const restored = deserializeChats(
      JSON.stringify([
        {
          id: "chat",
          preparedPrompt: { ...preparedPrompt, keywordSources: [null, "[keywords]: [Rust]", 42] },
        },
      ]),
    )?.[0];
    expect(restored?.preparedPrompt?.keywordSources).toEqual(["[keywords]: [Rust]"]);
    expect(restored?.preparedPrompt?.text).toBe(preparedPrompt.text);
  });

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

  it("после перезапуска сообщение помнит, сколько картинок потеряло", () => {
    const chats = [chatWith([{ role: "user", text: "что тут?", images: [img, img] }])];
    const restored = deserializeChats(serializeChats(chats));
    expect(restored?.[0]?.messages[0]).toEqual({
      role: "user",
      text: "что тут?",
      images: [],
      droppedImages: 2,
    });
    // A second restart does not reset the counter: the images are gone, but the count must be kept.
    const again = deserializeChats(serializeChats(restored ?? []));
    expect(again?.[0]?.messages[0]?.droppedImages).toBe(2);
    // A message without images gets no field at all — the file must not grow from zeros.
    expect(
      JSON.parse(serializeChats([chatWith([{ role: "user", text: "x", images: [] }])])) as unknown,
    ).toEqual([expect.objectContaining({ messages: [{ role: "user", text: "x", images: [] }] })]);
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
