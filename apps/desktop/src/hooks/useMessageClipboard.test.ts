import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChat, type ChatMessage } from "@/lib/chats";
import type { ChatsApi } from "./useChats";

const copyText = vi.fn<(text: string) => Promise<boolean>>(() => Promise.resolve(true));
vi.mock("@/lib/clipboard-text", () => ({
  copyTextReportingError: (text: string) => copyText(text),
}));
const copyImage = vi.fn<(png: string) => Promise<void>>(() => Promise.resolve());
vi.mock("@/ipc/commands", () => ({
  copyImageToClipboard: (png: string) => copyImage(png),
}));

import { useMessageClipboard } from "./useMessageClipboard";

const messages: ChatMessage[] = [
  { role: "user", text: "вопрос", images: [] },
  { role: "assistant", text: "первый ответ", images: [] },
  { role: "user", text: "", images: [{ media_type: "image/png", data: "png-bytes" }] },
  { role: "assistant", text: "последний ответ", images: [] },
];

function setup() {
  const active = { ...createChat(1, "c1"), messages };
  const api: Partial<ChatsApi> = { active };
  return renderHook(() => useMessageClipboard({ current: api as ChatsApi })).result.current;
}

beforeEach(() => {
  copyText.mockClear();
  copyImage.mockClear();
});

describe("useMessageClipboard", () => {
  it("копирует текст сообщения, а у снимка без подписи — саму картинку", async () => {
    const { copyMessage } = setup();
    copyMessage(1);
    expect(copyText).toHaveBeenCalledWith("первый ответ");
    copyMessage(2);
    await waitFor(() => {
      expect(copyImage).toHaveBeenCalledWith("png-bytes");
    });
    expect(copyText).toHaveBeenCalledTimes(1);
  });

  it("copyLastAnswer берёт последний ответ ассистента, несуществующий индекс молчит", () => {
    const { copyLastAnswer, copyMessage } = setup();
    copyLastAnswer();
    expect(copyText).toHaveBeenCalledWith("последний ответ");
    copyMessage(42);
    expect(copyText).toHaveBeenCalledTimes(1);
  });
});
