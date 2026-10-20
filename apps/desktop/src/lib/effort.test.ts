import { describe, expect, it } from "vitest";
import { effortMenu, effortPatch, effortRank } from "./effort";
import { FALLBACK_MODELS, type ModelInfo } from "./models";
import { PROVIDER_ANTHROPIC } from "@/test/providers";

const model = (extra: Partial<ModelInfo> = {}): ModelInfo => ({
  id: "m",
  displayName: "M",
  provider: PROVIDER_ANTHROPIC,
  adaptive: true,
  alwaysThinks: false,
  codeExec: true,
  efforts: ["low", "medium", "high", "xhigh", "max"],
  budgetThinking: false,
  defaultEffort: null,
  ...extra,
});

describe("effortMenu", () => {
  const claude = model({ alwaysThinks: true, defaultEffort: "medium" });

  it("модель с уровнями — как в claude.ai: только её уровни, без «выкл» и без «авто»", () => {
    expect(effortMenu(claude, { thinkingEnabled: false })).toEqual({
      choices: ["low", "medium", "high", "xhigh", "max"],
      current: "medium",
      defaultLevel: "medium",
      toggle: false,
      disabled: false,
    });
  });

  it("сохранённый уровень показывается, если модель его принимает, иначе — уровень по умолчанию", () => {
    const sonnet46 = model({
      alwaysThinks: true,
      efforts: ["low", "medium", "high", "max"],
      defaultEffort: "high",
    });
    expect(effortMenu(sonnet46, { thinkingEnabled: true, effort: "max" }).current).toBe("max");
    expect(effortMenu(sonnet46, { thinkingEnabled: true, effort: "xhigh" }).current).toBe("high");
  });

  it("«выкл» есть только там, где вендор умеет выключать (GPT с `none`)", () => {
    const gpt = model({
      alwaysThinks: false,
      efforts: ["low", "medium", "high"],
      defaultEffort: "medium",
    });
    const menu = effortMenu(gpt, { thinkingEnabled: false, effort: "high" });
    expect(menu.choices).toEqual(["off", "low", "medium", "high"]);
    expect(menu.current).toBe("off");
    expect(effortMenu(gpt, { thinkingEnabled: true }).current).toBe("medium");
  });

  it("модель с бюджетом рассуждения — переключатель «Расширенное рассуждение»", () => {
    const haiku = FALLBACK_MODELS.find((m) => m.id === "claude-haiku-4-5-20251001");
    expect(haiku?.budgetThinking).toBe(true);
    expect(effortMenu(haiku, { thinkingEnabled: true })).toEqual({
      choices: ["off", "on"],
      current: "on",
      defaultLevel: null,
      toggle: true,
      disabled: false,
    });
    expect(effortMenu(haiku, { thinkingEnabled: false }).current).toBe("off");
  });

  it("модель без рассуждения гасит контрол целиком", () => {
    const gpt4o = model({ adaptive: false, alwaysThinks: false, efforts: [], defaultEffort: null });
    expect(effortMenu(gpt4o, { thinkingEnabled: true })).toMatchObject({ disabled: true });
  });

  it("модель вне каталога: рассуждение переключается, уровни не обещаются", () => {
    expect(effortMenu(undefined, { thinkingEnabled: true, effort: "high" })).toMatchObject({
      choices: ["off", "on"],
      current: "on",
      toggle: true,
    });
  });

  it("офлайн-каталог приезжает с уровнями и уровнем по умолчанию из реестра", () => {
    const opus = FALLBACK_MODELS.find((m) => m.id === "claude-opus-5-5");
    expect(opus?.efforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(opus?.defaultEffort).toBe("medium");
    expect(opus?.alwaysThinks).toBe(true);
  });
});

describe("effortPatch", () => {
  it("уровень и «вкл» включают рассуждение, «выкл» трогает только тумблер", () => {
    expect(effortPatch("high")).toEqual({ thinkingEnabled: true, effort: "high" });
    expect(effortPatch("on")).toEqual({ thinkingEnabled: true });
    expect(effortPatch("off")).toEqual({ thinkingEnabled: false });
  });
});

describe("effortRank", () => {
  it("ранг — место на лестнице, от слабого к сильному", () => {
    expect(effortRank("low")).toBe(1);
    expect(effortRank("max")).toBe(5);
  });
});
