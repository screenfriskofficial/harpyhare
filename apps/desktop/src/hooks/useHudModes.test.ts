import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_MODE, NOTES_MODE } from "@/lib/modes";

let toggleMini: (() => void) | undefined;
vi.mock("@/ipc/events", () => ({
  onEvent: (_name: string, handler: () => void) => {
    toggleMini = handler;
    return () => undefined;
  },
}));

import { useHudModes } from "./useHudModes";

describe("useHudModes", () => {
  it("стартует в чате развёрнутым, переключает режим по кругу и сворачивается по событию", () => {
    const { result } = renderHook(() => useHudModes());
    expect(result.current.miniMode).toBe(false);
    expect(result.current.mode).toBe(DEFAULT_MODE);
    act(() => {
      result.current.toggleMode();
    });
    expect(result.current.mode).toBe(NOTES_MODE);
    expect(result.current.notesMode).toBe(true);
    act(() => {
      toggleMini?.();
    });
    expect(result.current.miniMode).toBe(true);
    act(() => {
      result.current.revealChat();
    });
    expect(result.current.miniMode).toBe(false);
    expect(result.current.mode).toBe(DEFAULT_MODE);
    act(() => {
      result.current.collapse();
    });
    expect(result.current.miniMode).toBe(true);
    expect(result.current.miniModeRef.current).toBe(true);
    act(() => {
      result.current.expand();
    });
    expect(result.current.miniMode).toBe(false);
  });
});
