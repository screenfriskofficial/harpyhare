import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/ipc/types";
import { createChat } from "@/lib/chats";
import type { ChatsApi } from "./useChats";

let deliver: ((text: string) => void) | undefined;
vi.mock("@/hooks/useTranscription", () => ({
  useTranscription: (onText: (text: string) => void) => {
    deliver = onText;
  },
}));

import { useTranscriptDelivery } from "./useTranscriptDelivery";

const A = { ...createChat(1, "a"), draft: "уже набрано" };
const B = createChat(2, "b");

function chatsApi(activeId: string): ChatsApi {
  const chats = [A, B];
  const active = chats.find((chat) => chat.id === activeId) ?? A;
  const api: Partial<ChatsApi> = {
    chats,
    activeId,
    active,
    selectChat: vi.fn(),
    patchChat: vi.fn(),
  };
  return api as ChatsApi;
}

function setup(autoSend: boolean) {
  const chatsRef = { current: chatsApi("a") };
  const settingsRef = { current: { ...DEFAULT_SETTINGS, auto_send: autoSend } };
  const dispatchSendTo = vi.fn();
  const clearSttFeedback = vi.fn();
  const revealChat = vi.fn();
  const hook = renderHook(
    ({ recorderState }: { recorderState: "idle" | "recording" | "transcribing" }) => {
      useTranscriptDelivery({
        chatsRef,
        settingsRef,
        recorderState,
        dispatchSendTo,
        clearSttFeedback,
        revealChat,
      });
    },
    { initialProps: { recorderState: "idle" } },
  );
  return { ...hook, chatsRef, dispatchSendTo, clearSttFeedback, revealChat };
}

describe("useTranscriptDelivery", () => {
  it("кладёт расшифровку в чат, где нажали PTT, и переключается на него", () => {
    const { rerender, chatsRef, clearSttFeedback, revealChat, dispatchSendTo } = setup(false);
    rerender({ recorderState: "recording" });
    // The user switched tabs while the recording was still going.
    chatsRef.current = chatsApi("b");
    rerender({ recorderState: "transcribing" });
    act(() => {
      deliver?.("новый вопрос");
    });
    const api = chatsRef.current;
    expect(api.patchChat).toHaveBeenCalledWith("a", { draft: "уже набрано новый вопрос" });
    expect(api.selectChat).toHaveBeenCalledWith("a");
    expect(revealChat).toHaveBeenCalledTimes(1);
    expect(clearSttFeedback).toHaveBeenCalledTimes(1);
    expect(dispatchSendTo).not.toHaveBeenCalled();
  });

  it("с автоотправкой шлёт объединённый черновик в тот же чат", () => {
    const { rerender, dispatchSendTo } = setup(true);
    rerender({ recorderState: "recording" });
    act(() => {
      deliver?.("вопрос");
    });
    expect(dispatchSendTo).toHaveBeenCalledWith("a", "уже набрано вопрос");
  });
});
