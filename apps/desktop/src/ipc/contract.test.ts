import { describe, expect, it } from "vitest";
import type { RequestOptions } from "@/lib/chats";
import type { AppError } from "@/lib/errors";
import { MODEL_PROVIDERS } from "@/lib/models";
import type { ModelInfo } from "@/lib/models";
import { API_KEY_IDS } from "@/lib/api-keys";
import { STT_PROVIDERS } from "@/lib/stt-providers";
import {
  PROVIDER_ANTHROPIC,
  PROVIDER_OPENAI,
  STT_PROVIDER_GROQ,
  STT_PROVIDER_OPENAI,
} from "@/test/providers";
import type { Platform } from "@/lib/platform";
import type { PromptPreset } from "@/lib/presets";
import type * as Rust from "./bindings";
import type {
  HotkeyBinding,
  AudioOutputDevice,
  EventMap,
  QuickAction,
  RecorderState,
  Settings,
  UpdateInfo,
} from "./types";

type Loosened<T> = { [K in keyof T]-?: Exclude<T[K], null> };

type SameKeys<Ours, Generated> = [keyof Ours] extends [keyof Generated]
  ? [keyof Generated] extends [keyof Ours]
    ? true
    : never
  : never;

type SameShape<Ours, Generated> = [Ours] extends [Generated]
  ? [Loosened<Generated>] extends [Ours]
    ? SameKeys<Ours, Generated>
    : never
  : never;

const contract = {
  Settings: true satisfies SameShape<Settings, Rust.Settings>,
  OutputDeviceInfo: true satisfies SameShape<AudioOutputDevice, Rust.OutputDeviceInfo>,
  UpdateInfo: true satisfies SameShape<UpdateInfo, Rust.UpdateInfo>,
  RecorderState: true satisfies SameShape<RecorderState, Rust.RecorderState>,
  PromptPreset: true satisfies SameShape<PromptPreset, Rust.PromptPreset>,
  AppError: true satisfies SameShape<AppError, Rust.AppError>,
  ModelInfo: true satisfies SameShape<ModelInfo, Rust.ModelInfo>,
  RequestOptions: true satisfies SameShape<RequestOptions, Rust.RequestOptions>,
  LlmDelta: true satisfies SameShape<EventMap["llm-delta"], Rust.LlmDelta>,
  LlmDone: true satisfies SameShape<EventMap["llm-done"], Rust.LlmDone>,
  LlmUsage: true satisfies SameShape<EventMap["llm-usage"], Rust.LlmUsage>,
  LlmErrorEvent: true satisfies SameShape<EventMap["llm-error"], Rust.LlmErrorEvent>,
  ResizeDim: true satisfies SameShape<EventMap["resize-key"]["dim"], Rust.ResizeDim>,
  UpdateProgress: true satisfies SameShape<EventMap["update-progress"], Rust.UpdateProgress>,
  UpdateDone: true satisfies SameShape<EventMap["update-done"], Rust.UpdateDone>,
  ScreenshotReady: true satisfies SameShape<EventMap["screenshot-ready"], Rust.ScreenshotReady>,
  HotkeyBinding: true satisfies SameShape<HotkeyBinding, Rust.HotkeyBinding>,
  QuickAction: true satisfies SameShape<QuickAction, Rust.QuickAction>,
  PlatformCombo: true satisfies SameShape<Record<Platform, string>, Rust.PlatformCombo>,
};

describe("рукописные типы IPC против сгенерированных из Rust", () => {
  it("совпадают по форме — иначе tsc не соберёт этот файл", () => {
    expect(Object.values(contract).every(Boolean)).toBe(true);
  });
});

describe("реестр LLM-провайдеров из Rust", () => {
  it("у каждого провайдера keyId — существующий ключ API", () => {
    // Первым это ловит tsc: константа печатается `as const`, поэтому keyId
    // приезжает литеральным типом и присваивание его `ApiKeyId` проверяется на
    // сборке. Тест оставлен как читаемая формулировка того же инварианта.
    for (const p of MODEL_PROVIDERS) {
      expect(API_KEY_IDS, `провайдер ${p.id}`).toContain(p.keyId);
    }
  });

  it("id, на которые ссылается фронт, реально объявлены в реестре", () => {
    const ids = MODEL_PROVIDERS.map((p) => p.id);
    expect(ids).toContain(PROVIDER_ANTHROPIC);
    expect(ids).toContain(PROVIDER_OPENAI);
  });

  it("реестр непустой и без дублей", () => {
    const ids = MODEL_PROVIDERS.map((p) => p.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("реестр STT-вендоров из Rust", () => {
  it("у каждого вендора keyId — существующий ключ API", () => {
    for (const p of STT_PROVIDERS) {
      expect(API_KEY_IDS, `вендор ${p.id}`).toContain(p.keyId);
    }
  });

  it("id, на которые ссылается фронт, реально объявлены в реестре", () => {
    const ids = STT_PROVIDERS.map((p) => p.id);
    expect(ids).toContain(STT_PROVIDER_GROQ);
    expect(ids).toContain(STT_PROVIDER_OPENAI);
  });

  it("реестр непустой и без дублей", () => {
    const ids = STT_PROVIDERS.map((p) => p.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("транспорт вендора на фронт не уезжает — пикер выбирает, но не звонит", () => {
    // Списком запрещённого, а не разрешённого: у пикера появляются новые поля
    // (supportsTranslate), а вот адрес и модель вендора появиться не должны.
    const transport = [
      "baseUrl",
      "wire",
      "path",
      "transcribePath",
      "translatePath",
      "warmUpPath",
      "transcribeModel",
      "translateModel",
      "temperature",
      "keyLabel",
    ];
    for (const p of STT_PROVIDERS) {
      for (const field of transport) {
        expect(Object.keys(p), `вендор ${p.id}`).not.toContain(field);
      }
    }
  });

  it("умение переводить объявлено у каждого вендора", () => {
    for (const p of STT_PROVIDERS) {
      expect(typeof p.supportsTranslate, `вендор ${p.id}`).toBe("boolean");
    }
    expect(STT_PROVIDERS.find((p) => p.id === "xai")?.supportsTranslate).toBe(false);
  });
});
