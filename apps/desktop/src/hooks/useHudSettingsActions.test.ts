import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/ipc/types";
import { useHudSettingsActions } from "./useHudSettingsActions";

describe("STT selection from the HUD", () => {
  it("saves provider and model together, preserving the latest unrelated settings", () => {
    const ref = { current: { ...DEFAULT_SETTINGS } };
    const save = vi.fn().mockResolvedValue(null);
    const { result } = renderHook(() => useHudSettingsActions(ref, save, false));
    ref.current = { ...ref.current, stt_language: "en" };
    act(() => {
      result.current.selectOpenrouterSttModel("vendor/model");
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({
      ...ref.current,
      stt_provider: "openrouter",
      openrouter_stt_model: "vendor/model",
    });
  });
});
