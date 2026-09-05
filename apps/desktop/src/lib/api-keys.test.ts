import { describe, expect, it } from "vitest";
import {
  accessGaps,
  API_KEY_IDS,
  availableAnswerProviders,
  modelProvidersMissingKey,
  sttProvidersMissingKey,
  vendorsOutsideCode,
  visibleApiKeys,
} from "./api-keys";
import {
  PROVIDER_ANTHROPIC,
  PROVIDER_OPENAI,
  PROVIDER_XAI,
  STT_PROVIDER_GROQ,
  STT_PROVIDER_OPENAI,
} from "@/test/providers";
import { MODEL_PROVIDERS } from "./models";
import { STT_PROVIDERS } from "./stt-providers";

const keys = (
  anthropic: string,
  groq: string,
  accessToken = "",
  sttProvider: string = STT_PROVIDER_GROQ,
  openai = "",
  xai = "",
  deepgram = "",
  xclis = "",
) => ({
  anthropic_api_key: anthropic,
  groq_api_key: groq,
  openai_api_key: openai,
  xai_api_key: xai,
  deepgram_api_key: deepgram,
  openrouter_api_key: "",
  xclis_api_key: xclis,
  access_token: accessToken,
  stt_provider: sttProvider,
});

describe("accessGaps", () => {
  it("без единого ключа не хватает и ответов, и распознавания", () => {
    const gaps = accessGaps(keys("", "")).map((g) => g.kind);
    expect(gaps).toEqual(["answers", "speech"]);
  });

  it("ЛЮБОГО одного ключа ответов достаточно — Anthropic больше не обязателен", () => {
    // Ключ Groq закрывает распознавание, ключ ответов — любой из трёх.
    for (const answerKey of [
      keys("sk-ant", "gsk_y"),
      keys("", "gsk_y", "", STT_PROVIDER_GROQ, "sk-oai"),
      keys("", "gsk_y", "", STT_PROVIDER_GROQ, "", "xai-key"),
    ]) {
      expect(accessGaps(answerKey)).toEqual([]);
    }
  });

  it("ключ ответов без ключа распознавания — не хватает только речи", () => {
    const gaps = accessGaps(keys("sk-ant", ""));
    expect(gaps.map((g) => g.kind)).toEqual(["speech"]);
    expect(gaps[0]?.label).toContain("Groq");
  });

  it("подсказка про речь называет ключ выбранного провайдера", () => {
    const gaps = accessGaps(keys("sk-ant", "gsk_y", "", STT_PROVIDER_OPENAI));
    expect(gaps.map((g) => g.kind)).toEqual(["speech"]);
    expect(gaps[0]?.label).toContain("OpenAI");
  });

  it("свой ключ распознавания закрывает речь без ключа ответов того же вендора", () => {
    expect(accessGaps(keys("sk-ant", "", "", STT_PROVIDER_OPENAI, "sk-oai"))).toEqual([]);
  });

  it("код доступа закрывает обе потребности сам", () => {
    expect(accessGaps(keys("", "", "itk_token"))).toEqual([]);
  });
});

describe("availableAnswerProviders", () => {
  it("перечисляет только тех, до кого реально дотянуться", () => {
    expect(availableAnswerProviders(keys("", ""))).toEqual([]);
    expect(availableAnswerProviders(keys("sk-ant", ""))).toEqual([PROVIDER_ANTHROPIC]);
    const xaiOnly = keys("", "", "", STT_PROVIDER_GROQ, "", "xai-key");
    expect(availableAnswerProviders(xaiOnly)).toEqual([PROVIDER_XAI]);
  });

  it("код доступа открывает всех вендоров ответов — relay проксирует каждого", () => {
    const available = availableAnswerProviders(keys("", "", "itk_token"));
    expect(available).toContain(PROVIDER_ANTHROPIC);
    expect(available).toContain(PROVIDER_OPENAI);
    expect(available).toContain(PROVIDER_XAI);
  });
});

describe("modelProvidersMissingKey", () => {
  it("без ключей заперты все вендоры ответов", () => {
    const locked = modelProvidersMissingKey(keys("", ""));
    expect(locked).toContain(PROVIDER_ANTHROPIC);
    expect(locked).toContain(PROVIDER_OPENAI);
    expect(locked).toContain(PROVIDER_XAI);
  });

  it("код доступа оставляет запертыми ровно тех, кого relay не проксирует", () => {
    // Замок снимается по флагу proxied реестра, а не по списку id: вендор,
    // которого воркер не проксирует, обязан остаться запертым сам собой.
    const locked = modelProvidersMissingKey(keys("", "", "itk_token"));
    expect(locked).toEqual(MODEL_PROVIDERS.filter((p) => !p.proxied).map((p) => p.id));
    // Сейчас такой вендор один — Xclis: у relay нет его роута.
    expect(locked).toEqual(["xclis"]);
  });

  it("свой ключ xAI открывает Grok и при коде доступа", () => {
    const withXai = keys("", "", "itk_token", STT_PROVIDER_GROQ, "", "xai-key");
    expect(modelProvidersMissingKey(withXai)).not.toContain(PROVIDER_XAI);
  });

  it("свой ключ открывает вендора без кода доступа", () => {
    const withXai = keys("", "", "", STT_PROVIDER_GROQ, "", "xai-key");
    expect(modelProvidersMissingKey(withXai)).not.toContain(PROVIDER_XAI);
  });
});

describe("код доступа и непроксируемые вендоры речи", () => {
  it("OpenRouter требует свой ключ и не открывает модели ответов", () => {
    for (const token of ["", "itk_code"]) {
      const settings = { ...keys("sk-ant", "", token), stt_provider: "openrouter" };
      expect(accessGaps(settings).map((g) => g.kind)).toEqual(["speech"]);
      expect(sttProvidersMissingKey(settings)).toContain("openrouter");
      const configured = { ...settings, openrouter_api_key: "sk-or-test" };
      expect(accessGaps(configured)).toEqual([]);
      expect(sttProvidersMissingKey(configured)).not.toContain("openrouter");
      expect(availableAnswerProviders(configured)).toEqual(availableAnswerProviders(settings));
    }
  });

  it("код доступа открывает только тех, кого проксирует relay", () => {
    const settings = {
      anthropic_api_key: "",
      groq_api_key: "",
      openai_api_key: "",
      xai_api_key: "",
      deepgram_api_key: "",
      openrouter_api_key: "",
      xclis_api_key: "",
      access_token: "itk_code",
      stt_provider: "groq",
    };
    const locked = sttProvidersMissingKey(settings);
    const proxied = STT_PROVIDERS.filter((p) => p.proxied).map((p) => p.id);
    const direct = STT_PROVIDERS.filter((p) => !p.proxied).map((p) => p.id);
    expect(proxied.every((id) => !locked.includes(id))).toBe(true);
    expect(direct.every((id) => locked.includes(id))).toBe(true);
  });

  it("непроксируемый вендор открывается своим ключом даже без кода", () => {
    const settings = {
      anthropic_api_key: "",
      groq_api_key: "",
      openai_api_key: "",
      xai_api_key: "xai-key",
      deepgram_api_key: "",
      openrouter_api_key: "",
      xclis_api_key: "",
      access_token: "",
      stt_provider: "xai",
    };
    expect(sttProvidersMissingKey(settings)).not.toContain("xai");
  });
});

describe("visibleApiKeys", () => {
  it("без кода доступа показываются все поля ключей", () => {
    expect(visibleApiKeys(keys("", ""))).toEqual(API_KEY_IDS);
  });

  it("код доступа оставляет поля только тех вендоров, кого relay не проксирует", () => {
    const outside = new Set(
      [...MODEL_PROVIDERS, ...STT_PROVIDERS].filter((v) => !v.proxied).map((v) => v.keyId),
    );
    expect(visibleApiKeys(keys("", "", "itk_token"))).toEqual(
      API_KEY_IDS.filter((id) => outside.has(id)),
    );
  });

  it("под кодом остаются поля только тех вендоров, до которых relay не дотягивается", () => {
    expect(vendorsOutsideCode()).toEqual(["Xclis", "Deepgram · Nova-3", "OpenRouter"]);
    expect(visibleApiKeys(keys("sk-ant", "gsk_y", "itk_token"))).toEqual([
      "deepgram",
      "openrouter",
      "xclis",
    ]);
  });
});
