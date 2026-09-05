import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TranscriptReady } from "@/ipc/bindings";

const { subscribe, copy, unsubscribe } = vi.hoisted(() => ({
  subscribe: vi.fn(),
  copy: vi.fn(() => Promise.resolve(true)),
  unsubscribe: vi.fn(),
}));
let receive: ((transcript: TranscriptReady) => void) | undefined;
vi.mock("@/ipc/events", () => ({
  onEvent: (name: string, handler: (transcript: TranscriptReady) => void) => {
    subscribe(name);
    receive = handler;
    return unsubscribe;
  },
}));
vi.mock("@/lib/clipboard-text", () => ({ copyTextReportingError: copy }));

import { useTranscription } from "./useTranscription";

const BOTH_VOICES: TranscriptReady = {
  separated: true,
  segments: [
    { source: "system", text: "Вопрос" },
    { source: "microphone", text: "Ответ" },
  ],
};

afterEach(() => {
  receive = undefined;
  vi.clearAllMocks();
});

describe("useTranscription", () => {
  it("delivers both sources once, with identical textarea and clipboard text", () => {
    const onText = vi.fn();
    renderHook(() => {
      useTranscription(onText);
    });
    act(() => receive?.(BOTH_VOICES));
    expect(onText).toHaveBeenCalledExactlyOnceWith("Собеседующий: Вопрос\n\nЯ: Ответ");
    expect(copy).toHaveBeenCalledExactlyOnceWith("Собеседующий: Вопрос\n\nЯ: Ответ");
  });

  it("keeps its subscription while delivering to the latest callback", () => {
    const first = vi.fn();
    const latest = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ onText }) => {
        useTranscription(onText);
      },
      {
        initialProps: { onText: first },
      },
    );
    rerender({ onText: latest });
    act(() => receive?.(BOTH_VOICES));
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledExactlyOnceWith("transcript-ready");
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("does not insert or copy empty recognition results", () => {
    const onText = vi.fn();
    renderHook(() => {
      useTranscription(onText);
    });
    act(() => receive?.({ separated: true, segments: [{ source: "microphone", text: "  " }] }));
    expect(onText).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();
  });
});
