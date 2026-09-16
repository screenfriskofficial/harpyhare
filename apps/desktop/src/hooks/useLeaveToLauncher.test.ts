import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deferred } from "@/test-utils/async";

const stopMainWindow = vi.fn<() => Promise<void>>(() => Promise.resolve());
vi.mock("@/ipc/commands", () => ({ stopMainWindow: () => stopMainWindow() }));
const notifyError = vi.fn<(message: string) => void>();
vi.mock("@/lib/notify", () => ({
  notifyError: (message: string) => {
    notifyError(message);
  },
}));

import { useLeaveToLauncher } from "./useLeaveToLauncher";

function setup() {
  const chats = deferred();
  const input = {
    flushChats: vi.fn(() => chats.promise),
    flushLibrary: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    flushSettings: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    flushPipelines: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    cancelPipelines: vi.fn(),
  };
  const { result } = renderHook(() => useLeaveToLauncher(input));
  return { leave: result.current, chats, input };
}

beforeEach(() => {
  stopMainWindow.mockClear();
  notifyError.mockClear();
});

describe("useLeaveToLauncher", () => {
  it("уничтожает окно только после того, как записаны все хвосты", async () => {
    const { leave, chats, input } = setup();
    leave();
    expect(input.cancelPipelines).toHaveBeenCalledTimes(1);
    expect(input.flushSettings).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(stopMainWindow).not.toHaveBeenCalled();
    chats.resolve();
    await waitFor(() => {
      expect(stopMainWindow).toHaveBeenCalledTimes(1);
    });
    expect(notifyError).not.toHaveBeenCalled();
  });

  it("после неудачной записи окно остаётся открытым, а тост называет причину", async () => {
    const { leave, chats } = setup();
    leave();
    chats.reject(new Error("диск полон"));
    await waitFor(() => {
      expect(notifyError).toHaveBeenCalledTimes(1);
    });
    expect(notifyError.mock.calls[0]?.[0]).toContain("диск полон");
    expect(stopMainWindow).not.toHaveBeenCalled();
  });
});
