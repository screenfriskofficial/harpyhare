import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadChats = vi.fn<() => Promise<string>>();
const saveChats = vi.fn<(json: string) => Promise<void>>();
vi.mock("@/ipc/commands", () => ({
  loadChats: () => loadChats(),
  saveChats: (json: string) => saveChats(json),
}));
const notify = vi.fn<(...a: unknown[]) => void>();
vi.mock("@/lib/notify", () => ({
  notify: (...a: unknown[]) => {
    notify(...a);
  },
}));

import { CHAT_LIMIT } from "@/lib/chats";
import type { Attachment } from "@/lib/composer";
import { useChats } from "./useChats";

const ATTACHMENT: Attachment = {
  payload: { media_type: "image/png", data: "AAAA" },
  preview: "data:image/png;base64,AAAA",
};

beforeEach(() => {
  vi.useFakeTimers();
  loadChats.mockResolvedValue("");
  saveChats.mockResolvedValue(undefined);
});
afterEach(() => {
  if (vi.isFakeTimers()) vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useChats", () => {
  it("стартует с одним пустым чатом, если на диске пусто", async () => {
    const { result } = renderHook(() => useChats());
    await waitFor(() => {
      expect(result.current.chats.length).toBe(1);
    });
    expect(result.current.active.messages).toEqual([]);
    expect(result.current.activeId).toBe(result.current.chats[0]?.id);
  });

  it("newChat добавляет чат, переключает на него и уважает лимит", async () => {
    const { result } = renderHook(() => useChats());
    await waitFor(() => {
      expect(result.current.chats.length).toBe(1);
    });
    for (let i = 1; i < CHAT_LIMIT; i++)
      act(() => {
        result.current.newChat();
      });
    expect(result.current.chats.length).toBe(CHAT_LIMIT);
    expect(result.current.activeId).toBe(result.current.chats[CHAT_LIMIT - 1]?.id);
    act(() => {
      result.current.newChat();
    });
    expect(result.current.chats.length).toBe(CHAT_LIMIT);
  });

  it("duplicateChat создаёт чистый чат с настройками исходного и уважает лимит", async () => {
    const { result } = renderHook(() => useChats());
    await waitFor(() => {
      expect(result.current.chats.length).toBe(1);
    });
    const sourceId = result.current.activeId;
    act(() => {
      result.current.appendUserMessage(sourceId, "вопрос", []);
      result.current.patchChat(sourceId, {
        model: "claude-opus-4-8",
        thinkingEnabled: true,
        webSearch: true,
        presetId: "golang",
        context: "справка",
        libraryDocIds: ["doc-1"],
        draft: "недописанное",
      });
    });
    act(() => {
      result.current.duplicateChat(sourceId);
    });
    expect(result.current.chats.length).toBe(2);
    const copy = result.current.active;
    expect(copy.id).not.toBe(sourceId);
    expect(result.current.activeId).toBe(copy.id);
    expect(copy.messages).toEqual([]);
    expect(copy.draft).toBe("");
    expect(copy.model).toBe("claude-opus-4-8");
    expect(copy.thinkingEnabled).toBe(true);
    expect(copy.webSearch).toBe(true);
    expect(copy.presetId).toBe("golang");
    expect(copy.context).toBe("справка");
    expect(copy.libraryDocIds).toEqual(["doc-1"]);
    while (result.current.chats.length < CHAT_LIMIT)
      act(() => {
        result.current.newChat();
      });
    act(() => {
      result.current.duplicateChat(result.current.activeId);
    });
    expect(result.current.chats.length).toBe(CHAT_LIMIT);
  });

  it("appendUserMessage ставит заголовок из первого вопроса и чистит черновик", async () => {
    const { result } = renderHook(() => useChats());
    await waitFor(() => {
      expect(result.current.chats.length).toBe(1);
    });
    const id = result.current.activeId;
    act(() => {
      result.current.patchChat(id, { draft: "длинный вопрос про рекурсию и стек" });
    });
    act(() => {
      result.current.appendUserMessage(id, "длинный вопрос про рекурсию и стек", []);
    });
    expect(result.current.active.title).toBe("длинный вопрос про рек…");
    expect(result.current.active.draft).toBe("");
    expect(result.current.active.messages).toHaveLength(1);
    expect(result.current.active.messages[0]?.role).toBe("user");
  });

  it("appendQuickActionMessage не трогает черновик и оставляет неотправленные вложения", async () => {
    const { result } = renderHook(() => useChats());
    await waitFor(() => {
      expect(result.current.chats.length).toBe(1);
    });
    const id = result.current.activeId;
    act(() => {
      result.current.patchChat(id, {
        draft: "недописанный промпт",
        draftAttachments: [ATTACHMENT],
      });
    });
    act(() => {
      result.current.appendQuickActionMessage(id, "Переведи на английский", []);
    });
    expect(result.current.active.messages).toHaveLength(1);
    expect(result.current.active.messages[0]?.text).toBe("Переведи на английский");
    expect(result.current.active.draft).toBe("недописанный промпт");
    expect(result.current.active.draftAttachments).toEqual([ATTACHMENT]);
  });

  it("appendQuickActionMessage чистит вложения, ушедшие в сообщение, но не черновик", async () => {
    const { result } = renderHook(() => useChats());
    await waitFor(() => {
      expect(result.current.chats.length).toBe(1);
    });
    const id = result.current.activeId;
    act(() => {
      result.current.patchChat(id, {
        draft: "недописанный промпт",
        draftAttachments: [ATTACHMENT],
      });
    });
    act(() => {
      result.current.appendQuickActionMessage(id, "Опиши скриншот", [ATTACHMENT.payload]);
    });
    expect(result.current.active.messages[0]?.images).toEqual([ATTACHMENT.payload]);
    expect(result.current.active.draftAttachments).toEqual([]);
    expect(result.current.active.draft).toBe("недописанный промпт");
    expect(result.current.active.title).toBe("Опиши скриншот");
  });

  it("removeMessage удаляет сообщение по индексу (и своё, и ответ)", async () => {
    const { result } = renderHook(() => useChats());
    await waitFor(() => {
      expect(result.current.chats.length).toBe(1);
    });
    const id = result.current.activeId;
    act(() => {
      result.current.appendUserMessage(id, "вопрос", []);
    });
    act(() => {
      result.current.appendAssistantMessage(id, "ответ");
    });
    act(() => {
      result.current.removeMessage(id, 1);
    });
    expect(result.current.active.messages.map((m) => m.role)).toEqual(["user"]);
    act(() => {
      result.current.removeMessage(id, 0);
    });
    expect(result.current.active.messages).toEqual([]);
  });

  it("clearMessages стирает историю и сбрасывает lastInputTokens, не трогая черновик", async () => {
    const { result } = renderHook(() => useChats());
    await waitFor(() => {
      expect(result.current.chats.length).toBe(1);
    });
    const id = result.current.activeId;
    act(() => {
      result.current.appendUserMessage(id, "вопрос", []);
    });
    act(() => {
      result.current.appendAssistantMessage(id, "ответ");
    });
    act(() => {
      result.current.patchChat(id, { lastInputTokens: 1234 });
    });
    act(() => {
      result.current.patchChat(id, { draft: "недописанный промпт" });
    });
    act(() => {
      result.current.clearMessages(id);
    });
    expect(result.current.active.messages).toEqual([]);
    expect(result.current.active.lastInputTokens).toBe(0);
    expect(result.current.active.draft).toBe("недописанный промпт");
  });

  it("appendAssistantMessage дописывает ответ", async () => {
    const { result } = renderHook(() => useChats());
    await waitFor(() => {
      expect(result.current.chats.length).toBe(1);
    });
    const id = result.current.activeId;
    act(() => {
      result.current.appendUserMessage(id, "вопрос", []);
    });
    act(() => {
      result.current.appendAssistantMessage(id, "ответ");
    });
    expect(result.current.active.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(result.current.active.messages[1]?.text).toBe("ответ");
  });

  it.each([
    { field: "presetId", initial: "", next: "mypreset" },
    { field: "model", initial: "claude-haiku-4-5-20251001", next: "claude-opus-4-8" },
    { field: "thinkingEnabled", initial: false, next: true },
    { field: "webSearch", initial: false, next: true },
    { field: "context", initial: "", next: "резюме кандидата" },
    { field: "libraryDocIds", initial: [], next: ["doc-1"] },
  ] as const)("patchChat меняет $field только в своём чате", async ({ field, initial, next }) => {
    const { result } = renderHook(() => useChats());
    await waitFor(() => {
      expect(result.current.chats.length).toBe(1);
    });
    expect(result.current.active[field]).toEqual(initial);
    const id = result.current.activeId;
    act(() => {
      result.current.newChat();
    });
    act(() => {
      result.current.patchChat(id, { [field]: next });
    });
    expect(result.current.chats.find((c) => c.id === id)?.[field]).toEqual(next);
    expect(result.current.active[field]).toEqual(initial);
  });

  it("patchChat пишет несколько полей за один вызов", async () => {
    const { result } = renderHook(() => useChats());
    await waitFor(() => {
      expect(result.current.chats.length).toBe(1);
    });
    const id = result.current.activeId;
    act(() => {
      result.current.patchChat(id, { context: "контекст", libraryDocIds: ["a", "b"] });
    });
    expect(result.current.active.context).toBe("контекст");
    expect(result.current.active.libraryDocIds).toEqual(["a", "b"]);
  });

  it("removeChat не даёт удалить последний и переключает активный", async () => {
    const { result } = renderHook(() => useChats());
    await waitFor(() => {
      expect(result.current.chats.length).toBe(1);
    });
    const first = result.current.activeId;
    act(() => {
      result.current.newChat();
    });
    const second = result.current.activeId;
    act(() => {
      result.current.removeChat(second);
    });
    expect(result.current.chats.length).toBe(1);
    expect(result.current.activeId).toBe(first);
    act(() => {
      result.current.removeChat(first);
    });
    expect(result.current.chats.length).toBe(1);
  });

  it("дебаунсит сохранение на диск", async () => {
    const { result } = renderHook(() => useChats());
    await waitFor(() => {
      expect(result.current.chats.length).toBe(1);
    });
    saveChats.mockClear();
    act(() => {
      result.current.newChat();
    });
    expect(saveChats).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(saveChats).toHaveBeenCalledTimes(1);
  });

  it("на размонтировании сбрасывает несохранённые чаты на диск", async () => {
    const { result, unmount } = renderHook(() => useChats());
    await waitFor(() => {
      expect(result.current.chats.length).toBe(1);
    });
    saveChats.mockClear();
    act(() => {
      result.current.newChat();
    });
    expect(saveChats).not.toHaveBeenCalled();
    unmount();
    expect(saveChats).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(saveChats.mock.calls[0]?.[0]))).toHaveLength(2);
  });

  it("загрузка с диска не порождает запись того же самого обратно", async () => {
    loadChats.mockResolvedValue(
      JSON.stringify([{ id: "a", title: "Чат 1", messages: [], draft: "черновик" }]),
    );
    const { result } = renderHook(() => useChats());
    await waitFor(() => {
      expect(result.current.active.draft).toBe("черновик");
    });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(saveChats).not.toHaveBeenCalled();
  });

  it("два newChat до ре-рендера на пороге лимита не уводят активный чат в никуда", async () => {
    const { result } = renderHook(() => useChats());
    await waitFor(() => {
      expect(result.current.chats.length).toBe(1);
    });
    for (let i = 1; i < CHAT_LIMIT - 1; i++)
      act(() => {
        result.current.newChat();
      });
    act(() => {
      result.current.newChat();
      result.current.newChat();
    });
    expect(result.current.chats.length).toBe(CHAT_LIMIT);
    expect(result.current.chats.some((c) => c.id === result.current.activeId)).toBe(true);
  });

  it("лимит вложений считается по актуальному черновику даже в одном act", async () => {
    const { result } = renderHook(() => useChats());
    await waitFor(() => {
      expect(result.current.chats.length).toBe(1);
    });
    const id = result.current.activeId;
    act(() => {
      result.current.patchChat(id, {
        draftAttachments: Array.from({ length: 5 }, (): Attachment => ATTACHMENT),
      });
    });
    await act(async () => {
      await result.current.addDraftImage(id, ATTACHMENT.preview, "image/png");
    });
    expect(result.current.active.draftAttachments).toHaveLength(5);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("вложений") as string }),
    );
  });

  it("addDraftImage добавляет вложение в черновик активного чата", async () => {
    vi.useRealTimers();
    const { result } = renderHook(() => useChats());
    await waitFor(() => {
      expect(result.current.chats.length).toBe(1);
    });
    const id = result.current.activeId;
    const dataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
    await act(async () => {
      await result.current.addDraftImage(id, dataUrl, "image/png");
    });
    expect(result.current.active.draftAttachments).toHaveLength(1);
    expect(result.current.active.draftAttachments[0]?.payload.media_type).toBe("image/png");
  });
});

describe("useChats — активный чат переживает выход", () => {
  const STORAGE_KEY = "active-chat-id";
  const TWO_CHATS = JSON.stringify([
    { id: "one", title: "Чат 1", messages: [], draft: "" },
    { id: "two", title: "Чат 2", messages: [], draft: "" },
  ]);
  const memory = new Map<string, string>();

  beforeEach(() => {
    memory.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
      clear: () => {
        memory.clear();
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("открывается тот чат, в котором вышли, а не первый", async () => {
    localStorage.setItem(STORAGE_KEY, "two");
    loadChats.mockResolvedValue(TWO_CHATS);
    const { result } = renderHook(() => useChats());
    await waitFor(() => {
      expect(result.current.chats.length).toBe(2);
    });
    expect(result.current.activeId).toBe("two");
  });

  it("если запомненный чат удалён, открывается первый", async () => {
    localStorage.setItem(STORAGE_KEY, "которого-нет");
    loadChats.mockResolvedValue(TWO_CHATS);
    const { result } = renderHook(() => useChats());
    await waitFor(() => {
      expect(result.current.chats.length).toBe(2);
    });
    expect(result.current.activeId).toBe("one");
  });

  it("переключение чата запоминается сразу", async () => {
    loadChats.mockResolvedValue(TWO_CHATS);
    const { result } = renderHook(() => useChats());
    await waitFor(() => {
      expect(result.current.chats.length).toBe(2);
    });
    act(() => {
      result.current.selectChat("two");
    });
    await waitFor(() => {
      expect(localStorage.getItem(STORAGE_KEY)).toBe("two");
    });
  });
});
