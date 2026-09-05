import { describe, expect, it } from "vitest";
import {
  curatedModels,
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
import { PROVIDER_ANTHROPIC, PROVIDER_OPENAI, PROVIDER_XAI } from "@/test/providers";

const model = (id: string, extra: Partial<ModelInfo> = {}): ModelInfo => ({
  id,
  displayName: id,
  provider: PROVIDER_ANTHROPIC,
  adaptive: true,
  alwaysThinks: false,
  codeExec: true,
  maxInputTokens: 0,
  ...extra,
});

const gpt = (id: string, extra: Partial<ModelInfo> = {}): ModelInfo =>
  model(id, { provider: PROVIDER_OPENAI, ...extra });

describe("models", () => {
  it("дефолт — haiku 4.5, он есть в фолбэк-списке", () => {
    expect(DEFAULT_MODEL).toBe("claude-haiku-4-5-20251001");
    expect(FALLBACK_MODELS.some((m) => m.id === DEFAULT_MODEL)).toBe(true);
    expect(FALLBACK_MODELS.some((m) => m.id === "claude-opus-4-8")).toBe(true);
  });

  it("modelLabel срезает бренд из display_name, иначе реконструирует из id", () => {
    expect(modelLabel({ id: "x", displayName: "Claude Sonnet 5" })).toBe("Sonnet 5");
    expect(modelLabel({ id: "claude-opus-4-8", displayName: "" })).toBe("Opus 4.8");
    expect(modelLabel({ id: "claude-haiku-4-5-20251001", displayName: "" })).toBe("Haiku 4.5");
  });

  it("selectableModels подмешивает текущую модель, если её нет в списке", () => {
    expect(selectableModels(FALLBACK_MODELS, "claude-opus-4-8")).toBe(FALLBACK_MODELS);
    const merged = selectableModels(FALLBACK_MODELS, "claude-custom-1");
    expect(merged[0]?.id).toBe("claude-custom-1");
    expect(merged.length).toBe(FALLBACK_MODELS.length + 1);
  });

  it("curatedModels оставляет по свежайшей модели семейств opus/sonnet/haiku", () => {
    const fetched = [
      model("claude-fable-5"),
      model("claude-opus-4-8"),
      model("claude-sonnet-5"),
      model("claude-sonnet-4-6"),
      model("claude-haiku-4-5-20251001"),
      model("claude-3-5-haiku-20241022"),
    ];
    expect(curatedModels(fetched).map((m) => m.id)).toEqual([
      "claude-opus-4-8",
      "claude-sonnet-5",
      "claude-haiku-4-5-20251001",
    ]);
  });

  it("curatedModels без единого совпадения отдаёт список как есть", () => {
    const exotic = [model("claude-fable-5")];
    expect(curatedModels(exotic)).toEqual(exotic);
  });

  it("curatedModels на фолбэке — тот же фолбэк", () => {
    expect(curatedModels(FALLBACK_MODELS)).toEqual(FALLBACK_MODELS);
  });

  it("curatedModels курирует по семействам только Claude, модели OpenAI отдаёт как есть", () => {
    const fetched = [
      model("claude-opus-4-8"),
      model("claude-sonnet-5"),
      model("claude-sonnet-4-6"),
      model("claude-haiku-4-5-20251001"),
      gpt("gpt-5.6-terra"),
      gpt("gpt-5.6-sol"),
      gpt("gpt-5.4-mini"),
    ];
    expect(curatedModels(fetched).map((m) => m.id)).toEqual([
      "claude-opus-4-8",
      "claude-sonnet-5",
      "claude-haiku-4-5-20251001",
      "gpt-5.6-terra",
      "gpt-5.6-sol",
      "gpt-5.4-mini",
    ]);
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

  it("defaultModelFor с одним лишь ключом xAI открывает чат на Grok", () => {
    const onlyXai = MODEL_PROVIDERS.filter((p) => p.id !== PROVIDER_XAI).map((p) => p.id);
    const chosen = defaultModelFor(onlyXai);
    expect(FALLBACK_MODELS.find((m) => m.id === chosen)?.provider).toBe(PROVIDER_XAI);
  });

  it("defaultModelFor не открывает чат на вендоре с динамическим каталогом", () => {
    // У агрегатора список моделей привязан к ключу и офлайн неизвестен, поэтому
    // дефолта он не называет. Открыть на нём чат до прихода живого каталога не
    // на чем: пустой id модели упал бы на первой же отправке.
    const dynamic = MODEL_PROVIDERS.filter((p) => p.defaultModel === "");
    expect(dynamic.length).toBeGreaterThan(0);
    const onlyDynamic = MODEL_PROVIDERS.filter((p) => p.defaultModel !== "").map((p) => p.id);
    expect(defaultModelFor(onlyDynamic)).toBe(DEFAULT_MODEL);
  });

  it("defaultModelFor без единого вендора остаётся на дефолте", () => {
    const allLocked = MODEL_PROVIDERS.map((p) => p.id);
    expect(defaultModelFor(allLocked)).toBe(DEFAULT_MODEL);
  });

  it.each(["openrouter", "xclis"])(
    "keeps %s models available under their provider, including saved models outside the live catalogue",
    (provider) => {
      const live = model(`${provider}/vendor/model`, { provider });
      const locked = MODEL_PROVIDERS.filter((p) => p.id !== provider).map((p) => p.id);
      expect(defaultModelFor(locked, [live])).toBe(live.id);
      expect(selectableModels([], live.id)[0]?.provider).toBe(provider);
      expect(curatedModels([live])).toEqual([live]);
    },
  );

  it("defaultModelFor без запертых вендоров — дефолт первого в реестре", () => {
    expect(defaultModelFor([])).toBe(DEFAULT_MODEL);
  });

  it("thinkingLocked: без adaptive или «думает всегда»", () => {
    expect(thinkingLocked(FALLBACK_MODELS, "claude-haiku-4-5-20251001")).toBe(true);
    expect(thinkingLocked(FALLBACK_MODELS, "claude-opus-4-8")).toBe(false);
    const withFable = [
      ...FALLBACK_MODELS,
      model("claude-fable-5", { displayName: "Claude Fable 5", alwaysThinks: true }),
    ];
    expect(thinkingLocked(withFable, "claude-fable-5")).toBe(true);
    expect(thinkingLocked(FALLBACK_MODELS, "claude-unknown")).toBe(false);
  });
});
