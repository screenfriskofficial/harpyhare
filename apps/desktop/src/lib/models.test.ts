import { describe, expect, it } from "vitest";
import {
  defaultModelFor,
  DEFAULT_MODEL,
  MODEL_PROVIDERS,
  FALLBACK_MODELS,
  modelGroups,
  modelLabel,
  withLockedModels,
  selectableModels,
  thinkingLocked,
  type ModelInfo,
} from "./models";
import { PROVIDER_ANTHROPIC, PROVIDER_OPENAI } from "@/test/providers";

const model = (id: string, extra: Partial<ModelInfo> = {}): ModelInfo => ({
  id,
  displayName: id,
  provider: PROVIDER_ANTHROPIC,
  adaptive: true,
  alwaysThinks: false,
  codeExec: true,
  efforts: [],
  budgetThinking: false,
  defaultEffort: null,
  ...extra,
});

const gpt = (id: string, extra: Partial<ModelInfo> = {}): ModelInfo =>
  model(id, { provider: PROVIDER_OPENAI, ...extra });

describe("models", () => {
  it("дефолт — haiku 4.5, он есть в фолбэк-списке", () => {
    expect(DEFAULT_MODEL).toBe("claude-haiku-4-5-20251001");
    expect(FALLBACK_MODELS.some((m) => m.id === DEFAULT_MODEL)).toBe(true);
    expect(FALLBACK_MODELS.some((m) => m.id === "claude-opus-5-5")).toBe(true);
  });

  it("modelLabel срезает бренд из display_name, иначе реконструирует из id", () => {
    expect(modelLabel({ id: "x", displayName: "Claude Sonnet 5" })).toBe("Sonnet 5");
    expect(modelLabel({ id: "claude-opus-4-8", displayName: "" })).toBe("Opus 4.8");
    expect(modelLabel({ id: "claude-haiku-4-5-20251001", displayName: "" })).toBe("Haiku 4.5");
  });

  it("selectableModels подмешивает текущую модель, если её нет в списке", () => {
    expect(selectableModels(FALLBACK_MODELS, "claude-opus-5-5")).toBe(FALLBACK_MODELS);
    const merged = selectableModels(FALLBACK_MODELS, "claude-custom-1");
    expect(merged[0]?.id).toBe("claude-custom-1");
    expect(merged.length).toBe(FALLBACK_MODELS.length + 1);
  });

  it("withLockedModels дописывает вендора, которого бэкенд не вернул", () => {
    const onlyClaude = FALLBACK_MODELS.filter((m) => m.provider === PROVIDER_ANTHROPIC);
    const merged = withLockedModels(onlyClaude);
    expect(merged.some((m) => m.provider === PROVIDER_OPENAI)).toBe(true);
    expect(merged.filter((m) => m.provider === PROVIDER_ANTHROPIC)).toEqual(onlyClaude);
  });

  it("withLockedModels ничего не дублирует, когда вендор уже ответил", () => {
    expect(withLockedModels(FALLBACK_MODELS)).toEqual(FALLBACK_MODELS);
  });

  it("modelGroups: один провайдер — одна группа", () => {
    const onlyClaude = FALLBACK_MODELS.filter((m) => m.provider === PROVIDER_ANTHROPIC);
    const groups = modelGroups(onlyClaude);
    expect(groups.length).toBe(1);
    expect(groups[0]?.label).toBe("Claude");
    expect(groups[0]?.models).toEqual(onlyClaude);
  });

  it("modelGroups раскладывает модели по провайдерам в порядке реестра", () => {
    const groups = modelGroups([gpt("gpt-5.6-terra"), model("claude-opus-4-8")]);
    expect(groups.map((g) => g.label)).toEqual(["Claude", "OpenAI"]);
    expect(groups[0]?.models.map((m) => m.id)).toEqual(["claude-opus-4-8"]);
    expect(groups[1]?.models.map((m) => m.id)).toEqual(["gpt-5.6-terra"]);
  });

  it("modelGroups не теряет модель чата, оставшуюся без провайдера", () => {
    const groups = modelGroups(selectableModels(FALLBACK_MODELS, "gpt-снятая-с-учёта"));
    expect(groups.at(-1)?.label).toBe("Другие");
    expect(groups.at(-1)?.models.map((m) => m.id)).toEqual(["gpt-снятая-с-учёта"]);
  });

  it("defaultModelFor берёт первого доступного вендора, а не всегда Claude", () => {
    const anthropicLocked = MODEL_PROVIDERS.filter((p) => p.id !== PROVIDER_OPENAI).map(
      (p) => p.id,
    );
    const chosen = defaultModelFor(anthropicLocked);
    expect(FALLBACK_MODELS.find((m) => m.id === chosen)?.provider).toBe(PROVIDER_OPENAI);
  });

  it("defaultModelFor без единого вендора остаётся на дефолте", () => {
    const allLocked = MODEL_PROVIDERS.map((p) => p.id);
    expect(defaultModelFor(allLocked)).toBe(DEFAULT_MODEL);
  });

  it("defaultModelFor без запертых вендоров — дефолт первого в реестре", () => {
    expect(defaultModelFor([])).toBe(DEFAULT_MODEL);
  });

  it("thinkingLocked: модель не рассуждает или рассуждает всегда", () => {
    // Haiku 4.5 рассуждает по бюджету — тумблер живой, это и есть «Расширенное».
    expect(thinkingLocked(FALLBACK_MODELS, "claude-haiku-4-5-20251001")).toBe(false);
    // Модель с уровнями, как в claude.ai, не выключается — управляет уровень.
    expect(thinkingLocked(FALLBACK_MODELS, "claude-opus-5-5")).toBe(true);
    expect(thinkingLocked([model("gpt-4o", { adaptive: false })], "gpt-4o")).toBe(true);
    const withFable = [
      ...FALLBACK_MODELS,
      model("claude-fable-5", { displayName: "Claude Fable 5", alwaysThinks: true }),
    ];
    expect(thinkingLocked(withFable, "claude-fable-5")).toBe(true);
    expect(thinkingLocked(FALLBACK_MODELS, "claude-unknown")).toBe(false);
  });
});
