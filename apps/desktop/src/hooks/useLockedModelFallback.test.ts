import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/ipc/types";
import { modelProvidersMissingKey } from "@/lib/api-keys";
import { defaultModelFor, FALLBACK_MODELS } from "@/lib/models";
import { PROVIDER_ANTHROPIC, PROVIDER_OPENAI } from "@/test/providers";
import { useLockedModelFallback } from "./useLockedModelFallback";

function modelOf(provider: string): string {
  const model = FALLBACK_MODELS.find((m) => m.provider === provider);
  if (!model) throw new Error(`no fallback model for ${provider}`);
  return model.id;
}

// Only OpenAI has a key: Claude is locked, GPT is not.
const settings = { ...DEFAULT_SETTINGS, openai_api_key: "sk-test" };

function setup(chatModel: string, settingsLoading = false) {
  const patchChat = vi.fn();
  renderHook(() =>
    useLockedModelFallback({
      settings,
      settingsLoading,
      models: FALLBACK_MODELS,
      chatId: "c1",
      chatModel,
      patchChat,
    }),
  );
  return patchChat;
}

describe("useLockedModelFallback", () => {
  it("чат на модели запертого вендора переезжает на доступную модель по умолчанию", () => {
    const patchChat = setup(modelOf(PROVIDER_ANTHROPIC));
    expect(patchChat).toHaveBeenCalledWith("c1", {
      model: defaultModelFor(modelProvidersMissingKey(settings), FALLBACK_MODELS),
    });
  });

  it("чат на доступной модели не трогается, как и любой чат до загрузки настроек", () => {
    expect(setup(modelOf(PROVIDER_OPENAI))).not.toHaveBeenCalled();
    expect(setup(modelOf(PROVIDER_ANTHROPIC), true)).not.toHaveBeenCalled();
  });
});
