import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FALLBACK_MODELS, type ModelInfo } from "@/lib/models";
import { PROVIDER_ANTHROPIC } from "@/test/providers";

/** Every vendor the backend did not report is appended locked, whoever they are. */
const LOCKED_OTHERS = FALLBACK_MODELS.filter((m) => m.provider !== PROVIDER_ANTHROPIC);
import { createQueryWrapper } from "@/test/query-wrapper";

const listModels = vi.fn<() => Promise<ModelInfo[]>>();
vi.mock("@/ipc/commands", () => ({
  listModels: () => listModels(),
}));

import { useModels } from "./useModels";

afterEach(() => {
  vi.clearAllMocks();
});

describe("useModels", () => {
  it("до ответа — фолбэк, после — курированный список из API плюс запертые вендоры", async () => {
    const sonnet: ModelInfo = {
      id: "claude-sonnet-5",
      provider: PROVIDER_ANTHROPIC,
      displayName: "Claude Sonnet 5",
      adaptive: true,
      alwaysThinks: false,
      codeExec: true,
      maxInputTokens: 0,
    };
    const fable: ModelInfo = {
      id: "claude-fable-5",
      provider: PROVIDER_ANTHROPIC,
      displayName: "Claude Fable 5",
      adaptive: true,
      alwaysThinks: true,
      codeExec: true,
      maxInputTokens: 0,
    };
    listModels.mockResolvedValue([sonnet, fable]);
    const { result } = renderHook(() => useModels(), { wrapper: createQueryWrapper() });
    expect(result.current.models).toBe(FALLBACK_MODELS);
    // Пока данные предварительные, пикер обязан это знать: вшитый список не
    // содержит моделей вендора с динамическим каталогом.
    expect(result.current.pending).toBe(true);
    await waitFor(() => {
      expect(result.current.models).toEqual([sonnet, ...LOCKED_OTHERS]);
      expect(result.current.pending).toBe(false);
    });
  });

  it("пустой ответ — остаёмся на фолбэке", async () => {
    listModels.mockResolvedValue([]);
    const { result } = renderHook(() => useModels(), { wrapper: createQueryWrapper() });
    await waitFor(() => {
      expect(listModels).toHaveBeenCalled();
    });
    expect(result.current.models).toEqual(FALLBACK_MODELS);
  });

  it("ошибка каталога — список остаётся предварительным, а не «настоящим» вшитым", async () => {
    listModels.mockRejectedValue(new Error("сеть"));
    const { result } = renderHook(() => useModels(), { wrapper: createQueryWrapper() });
    await waitFor(() => {
      expect(listModels).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(result.current.models).toEqual(FALLBACK_MODELS);
      expect(result.current.pending).toBe(true);
    });
  });
});
