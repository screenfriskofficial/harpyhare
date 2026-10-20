import { describe, expect, it } from "vitest";
import {
  accessGaps,
  API_KEY_IDS,
  availableAnswerProviders,
  modelProvidersMissingKey,
  sttProvidersMissingKey,
} from "./api-keys";
import { PROVIDER_ANTHROPIC, PROVIDER_OPENAI, STT_PROVIDER_DEEPGRAM } from "@/test/providers";
import { MODEL_PROVIDERS } from "./models";
import { STT_PROVIDERS } from "./stt-providers";

const keys = (anthropic: string, deepgram: string, openai = "") => ({
  anthropic_api_key: anthropic,
  openai_api_key: openai,
  deepgram_api_key: deepgram,
  stt_provider: STT_PROVIDER_DEEPGRAM,
});

describe("accessGaps", () => {
  it("без единого ключа не хватает и ответов, и распознавания", () => {
    const gaps = accessGaps(keys("", "")).map((g) => g.kind);
    expect(gaps).toEqual(["answers", "speech"]);
  });

  it("ЛЮБОГО одного ключа ответов достаточно — Anthropic не обязателен", () => {
    for (const answerKey of [keys("sk-ant", "dg"), keys("", "dg", "sk-oai")]) {
      expect(accessGaps(answerKey)).toEqual([]);
    }
  });

  it("ключ ответов без ключа распознавания — не хватает только речи, и подсказка называет его", () => {
    const gaps = accessGaps(keys("sk-ant", ""));
    expect(gaps.map((g) => g.kind)).toEqual(["speech"]);
    expect(gaps[0]?.label).toContain("Deepgram");
  });

  it("сохранённый вендор, которого в приложении больше нет, просит ключ того, что есть", () => {
    const gaps = accessGaps({ ...keys("sk-ant", ""), stt_provider: "groq" });
    expect(gaps[0]?.label).toContain("Deepgram");
    expect(accessGaps({ ...keys("sk-ant", "dg"), stt_provider: "groq" })).toEqual([]);
  });
});

describe("availableAnswerProviders", () => {
  it("перечисляет только тех, до кого реально дотянуться", () => {
    expect(availableAnswerProviders(keys("", ""))).toEqual([]);
    expect(availableAnswerProviders(keys("sk-ant", ""))).toEqual([PROVIDER_ANTHROPIC]);
    expect(availableAnswerProviders(keys("", "", "sk-oai"))).toEqual([PROVIDER_OPENAI]);
  });
});

describe("modelProvidersMissingKey", () => {
  it("без ключей заперты все вендоры ответов", () => {
    expect(modelProvidersMissingKey(keys("", ""))).toEqual(MODEL_PROVIDERS.map((p) => p.id));
  });

  it("свой ключ открывает своего вендора и только его", () => {
    const locked = modelProvidersMissingKey(keys("sk-ant", ""));
    expect(locked).not.toContain(PROVIDER_ANTHROPIC);
    expect(locked).toContain(PROVIDER_OPENAI);
  });

  it("пробелы — не ключ", () => {
    expect(modelProvidersMissingKey(keys("   ", ""))).toContain(PROVIDER_ANTHROPIC);
  });
});

describe("sttProvidersMissingKey", () => {
  it("вендор речи заперт без своего ключа и открыт с ним", () => {
    expect(sttProvidersMissingKey(keys("", ""))).toEqual(STT_PROVIDERS.map((p) => p.id));
    expect(sttProvidersMissingKey(keys("", "dg"))).toEqual([]);
  });

  it("у каждого вендора — ключ из реестра ключей", () => {
    for (const p of [...MODEL_PROVIDERS, ...STT_PROVIDERS]) {
      expect(API_KEY_IDS).toContain(p.keyId);
    }
  });
});
