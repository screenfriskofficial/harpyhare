import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadChats = vi.fn<() => Promise<string>>();
const saveChats = vi.fn<(json: string) => Promise<void>>();
vi.mock("@/ipc/commands", () => ({
  loadChats: () => loadChats(),
  saveChats: (json: string) => saveChats(json),
}));

import { CHAT_LIMIT } from "@/lib/chats";
import { useChats } from "./useChats";

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
