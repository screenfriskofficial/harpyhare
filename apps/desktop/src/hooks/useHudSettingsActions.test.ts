import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/ipc/types";
import { useHudSettingsActions } from "./useHudSettingsActions";
import { STT_PROVIDER_DEEPGRAM } from "@/test/providers";

describe("STT selection from the HUD", () => {
  it("saves the provider over the latest snapshot, not the one taken at render", () => {
    const ref = { current: { ...DEFAULT_SETTINGS } };
    const save = vi.fn().mockResolvedValue(null);
    const { result } = renderHook(() => useHudSettingsActions(ref, save, false));
    ref.current = { ...ref.current, stt_language: "en" };
    act(() => {
      result.current.switchSttProvider(STT_PROVIDER_DEEPGRAM);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ ...ref.current, stt_provider: STT_PROVIDER_DEEPGRAM });
  });
});
