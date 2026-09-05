import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (payload: unknown) => void;
const handlers = new Map<string, Handler>();
const sendToClaude = vi.fn<(...args: unknown[]) => Promise<void>>();
const cancelStream = vi.fn<(...args: unknown[]) => void>();

vi.mock("@/ipc/events", () => ({
  onEvent: (name: string, handler: Handler) => {
    handlers.set(name, handler);
    return () => {
      handlers.delete(name);
    };
  },
}));
vi.mock("@/lib/notify", () => ({
  notifyAppError: vi.fn(),
  notify: vi.fn(),
}));
vi.mock("@/ipc/commands", () => ({
  sendToClaude: (...args: unknown[]) => sendToClaude(...args),
  cancelStream: (...args: unknown[]) => {
    cancelStream(...args);
  },
}));

import { useClaudeStream } from "./useClaudeStream";

function streamIdOf(chatId: string, nth = -1): string {
  const calls = sendToClaude.mock.calls.filter((c) => c[1] === chatId);
  const call = nth < 0 ? calls[calls.length + nth] : calls[nth];
  const streamId = call?.[2];
  return typeof streamId === "string" ? streamId : "";
}

function withStreamId(payload: unknown): unknown {
  if (typeof payload !== "object" || payload === null) return payload;
  const fields = payload as Record<string, unknown>;
  const chatId = fields["chatId"];
  if (typeof chatId !== "string" || "streamId" in fields) return payload;
  return { ...fields, streamId: streamIdOf(chatId) };
}

function emit(name: string, payload: unknown) {
  act(() => handlers.get(name)?.(withStreamId(payload)));
}

let frameCallbacks: FrameRequestCallback[] = [];
let frameNow = 0;
const FRAME_DT_MS = 400;

function runFrames(count: number, dtMs = FRAME_DT_MS) {
  for (let i = 0; i < count; i += 1) {
    const callbacks = frameCallbacks;
    frameCallbacks = [];
    frameNow += dtMs;
    act(() => {
      for (const cb of callbacks) cb(frameNow);
    });
  }
}

beforeEach(() => {
  frameCallbacks = [];
  frameNow = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frameCallbacks.push(cb);
    return frameCallbacks.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});
afterEach(() => {
  handlers.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("useClaudeStream (per-chat)", () => {
  it("роутит дельты в нужный чат", () => {
    const onComplete = vi.fn();
    const onUsage = vi.fn();
    const { result } = renderHook(() => useClaudeStream(onComplete, onUsage));
    act(
      () =>
        void result.current.send(
          "A",
          [{ role: "user", text: "q", images: [] }],
          "",
          "claude-opus-4-8",
          { thinking: true, webSearch: false },
        ),
    );
    emit("llm-delta", { chatId: "A", delta: "при" });
    emit("llm-delta", { chatId: "A", delta: "вет" });
    runFrames(2);
    expect(result.current.partial["A"]).toBe("привет");
    expect(result.current.streaming["A"]).toBe(true);
  });

  it("раскрывает буфер постепенно, а не разом", () => {
    const { result } = renderHook(() => useClaudeStream(vi.fn(), vi.fn()));
    act(
      () =>
        void result.current.send(
          "A",
          [{ role: "user", text: "q", images: [] }],
          "",
          "claude-opus-4-8",
          { thinking: true, webSearch: false },
        ),
    );
    emit("llm-delta", { chatId: "A", delta: "x".repeat(100000) });
    runFrames(2, 50);
    const shown = result.current.partial["A"] ?? "";
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(100000);
  });

  it("два параллельных стрима не смешиваются", () => {
    const { result } = renderHook(() => useClaudeStream(vi.fn(), vi.fn()));
    act(
      () =>
        void result.current.send(
          "A",
          [{ role: "user", text: "q", images: [] }],
          "",
          "claude-opus-4-8",
          { thinking: true, webSearch: false },
        ),
    );
    act(
      () =>
        void result.current.send(
          "B",
          [{ role: "user", text: "q", images: [] }],
          "",
          "claude-opus-4-8",
          { thinking: true, webSearch: false },
        ),
    );
    emit("llm-delta", { chatId: "A", delta: "AAA" });
    emit("llm-delta", { chatId: "B", delta: "BBB" });
    runFrames(2);
    expect(result.current.partial["A"]).toBe("AAA");
    expect(result.current.partial["B"]).toBe("BBB");
  });

  it("llm-done вызывает onComplete с полным текстом и снимает streaming", () => {
    const onComplete = vi.fn();
    const onUsage = vi.fn();
    const { result } = renderHook(() => useClaudeStream(onComplete, onUsage));
    act(
      () =>
        void result.current.send(
          "A",
          [{ role: "user", text: "q", images: [] }],
          "",
          "claude-opus-4-8",
          { thinking: true, webSearch: false },
        ),
    );
    emit("llm-delta", { chatId: "A", delta: "итог" });
    emit("llm-done", { chatId: "A" });
    expect(onComplete).toHaveBeenCalledWith("A", "итог");
    expect(result.current.streaming["A"]).toBeFalsy();
    expect(result.current.partial["A"]).toBeUndefined();
  });

  it("после stop поздние дельты игнорируются", () => {
    const { result } = renderHook(() => useClaudeStream(vi.fn(), vi.fn()));
    act(
      () =>
        void result.current.send(
          "A",
          [{ role: "user", text: "q", images: [] }],
          "",
          "claude-opus-4-8",
          { thinking: true, webSearch: false },
        ),
    );
    act(() => {
      result.current.stop("A");
    });
    expect(cancelStream).toHaveBeenCalledWith("A", streamIdOf("A"));
    emit("llm-delta", { chatId: "A", delta: "поздно" });
    expect(result.current.partial["A"]).toBeUndefined();
  });

  it("stop сохраняет частичный ответ через onComplete (не выбрасывает)", () => {
    const onComplete = vi.fn();
    const onUsage = vi.fn();
    const { result } = renderHook(() => useClaudeStream(onComplete, onUsage));
    act(
      () =>
        void result.current.send(
          "A",
          [{ role: "user", text: "q", images: [] }],
          "",
          "claude-opus-4-8",
          { thinking: true, webSearch: false },
        ),
    );
    emit("llm-delta", { chatId: "A", delta: "почти готовый ответ" });
    act(() => {
      result.current.stop("A");
    });
    expect(onComplete).toHaveBeenCalledWith("A", "почти готовый ответ");
    expect(result.current.partial["A"]).toBeUndefined();
    emit("llm-done", { chatId: "A" });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("stop затем новый send не закрывает новый стрим поздним llm-done", () => {
    const onComplete = vi.fn();
    const onUsage = vi.fn();
    const { result } = renderHook(() => useClaudeStream(onComplete, onUsage));
    act(
      () =>
        void result.current.send(
          "A",
          [{ role: "user", text: "q", images: [] }],
          "",
          "claude-opus-4-8",
          { thinking: true, webSearch: false },
        ),
    );
    emit("llm-delta", { chatId: "A", delta: "старый" });
    act(() => {
      result.current.stop("A");
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
    act(
      () =>
        void result.current.send(
          "A",
          [{ role: "user", text: "q2", images: [] }],
          "",
          "claude-opus-4-8",
          { thinking: true, webSearch: false },
        ),
    );
    emit("llm-done", { chatId: "A", streamId: streamIdOf("A", 0) });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(result.current.streaming["A"]).toBe(true);
    emit("llm-delta", { chatId: "A", delta: "новый" });
    emit("llm-done", { chatId: "A" });
    expect(onComplete).toHaveBeenCalledTimes(2);
    expect(onComplete).toHaveBeenLastCalledWith("A", "новый");
  });

  it("usage от прошлой генерации не перезаписывает счётчик новой", () => {
    const onUsage = vi.fn();
    const { result } = renderHook(() => useClaudeStream(vi.fn(), onUsage));
    const send = () => {
      act(
        () =>
          void result.current.send(
            "A",
            [{ role: "user", text: "q", images: [] }],
            "",
            "claude-opus-4-8",
            { thinking: true, webSearch: false },
          ),
      );
    };
    send();
    act(() => {
      result.current.stop("A");
    });
    send();
    emit("llm-usage", { chatId: "A", streamId: streamIdOf("A", 0), inputTokens: 111 });
    expect(onUsage).not.toHaveBeenCalled();
    emit("llm-usage", { chatId: "A", inputTokens: 222 });
    expect(onUsage).toHaveBeenCalledExactlyOnceWith("A", 222);
  });

  it("stop без полученного текста не трогает onComplete", () => {
    const onComplete = vi.fn();
    const onUsage = vi.fn();
    const { result } = renderHook(() => useClaudeStream(onComplete, onUsage));
    act(
      () =>
        void result.current.send(
          "A",
          [{ role: "user", text: "q", images: [] }],
          "",
          "claude-opus-4-8",
          { thinking: true, webSearch: false },
        ),
    );
    act(() => {
      result.current.stop("A");
    });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("llm-error сохраняет частичный ответ и показывает ошибку", () => {
    const onComplete = vi.fn();
    const onUsage = vi.fn();
    const { result } = renderHook(() => useClaudeStream(onComplete, onUsage));
    act(
      () =>
        void result.current.send(
          "A",
          [{ role: "user", text: "q", images: [] }],
          "",
          "claude-opus-4-8",
          { thinking: true, webSearch: false },
        ),
    );
    emit("llm-delta", { chatId: "A", delta: "начало ответа" });
    emit("llm-error", { chatId: "A", code: "network", message: "оборвалось" });
    expect(onComplete).toHaveBeenCalledWith("A", "начало ответа");
    expect(result.current.error["A"]).toEqual({ code: "network", message: "оборвалось" });
    expect(result.current.streaming["A"]).toBeFalsy();
  });

  it("llm-error кладёт ошибку в чат и снимает streaming", () => {
    const { result } = renderHook(() => useClaudeStream(vi.fn(), vi.fn()));
    act(
      () =>
        void result.current.send(
          "A",
          [{ role: "user", text: "q", images: [] }],
          "",
          "claude-opus-4-8",
          { thinking: true, webSearch: false },
        ),
    );
    emit("llm-error", { chatId: "A", code: "api", message: "сломалось" });
    expect(result.current.error["A"]).toEqual({ code: "api", message: "сломалось" });
    expect(result.current.streaming["A"]).toBeFalsy();
  });

  it("второй send в тот же чат до ре-рендера отвергается, первый стрим живёт", () => {
    const onComplete = vi.fn();
    const { result } = renderHook(() => useClaudeStream(onComplete, vi.fn()));
    act(() => {
      void result.current.send("A", [], "", "m", { thinking: false, webSearch: false });
      void result.current.send("A", [], "", "m", { thinking: false, webSearch: false });
    });
    expect(sendToClaude).toHaveBeenCalledTimes(1);
    expect(result.current.isStreaming("A")).toBe(true);
    emit("llm-delta", { chatId: "A", delta: "ответ" });
    emit("llm-done", { chatId: "A" });
    expect(onComplete).toHaveBeenCalledWith("A", "ответ");
    expect(result.current.isStreaming("A")).toBe(false);
  });

  it("discard отменяет стрим и выбрасывает буфер без onComplete", () => {
    const onComplete = vi.fn();
    const { result } = renderHook(() => useClaudeStream(onComplete, vi.fn()));
    act(() => {
      void result.current.send("A", [], "", "m", { thinking: false, webSearch: false });
    });
    emit("llm-delta", { chatId: "A", delta: "частичный" });
    act(() => {
      result.current.discard("A");
    });
    expect(cancelStream).toHaveBeenCalledWith("A", streamIdOf("A"));
    expect(onComplete).not.toHaveBeenCalled();
    expect(result.current.partial["A"]).toBeUndefined();
    expect(result.current.streaming["A"]).toBe(false);
    emit("llm-done", { chatId: "A" });
    expect(onComplete).not.toHaveBeenCalled();
  });
});
