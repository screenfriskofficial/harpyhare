import { MODEL_PROVIDERS } from "./models";
import { STT_PROVIDERS, sttProviderKeyId } from "./stt-providers";

export type ApiKeyId =
  "anthropic" | "groq" | "openai" | "xai" | "deepgram" | "xclis" | "openrouter";

export interface ApiKeyInfo {
  id: ApiKeyId;
  name: string;
  purpose: string;
  consoleUrl: string;
}

const API_KEYS = [
  {
    id: "anthropic",
    name: "Anthropic",
    purpose: "ответов Claude",
    consoleUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "groq",
    name: "Groq",
    purpose: "распознавания речи через Whisper",
    consoleUrl: "https://console.groq.com/keys",
  },
  {
    id: "openai",
    name: "OpenAI",
    purpose: "ответов GPT и распознавания речи через OpenAI",
    consoleUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "xai",
    name: "xAI",
    purpose: "ответов Grok",
    consoleUrl: "https://console.x.ai/team/default/api-keys",
  },
  {
    id: "deepgram",
    name: "Deepgram",
    purpose: "распознавания речи в реальном времени",
    consoleUrl: "https://console.deepgram.com/",
  },
  {
    id: "xclis",
    name: "Xclis",
    purpose: "ответов через агрегатор Xclis",
    consoleUrl: "https://jp.xclis.ai/",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    purpose: "ответов Claude через OpenRouter",
    consoleUrl: "https://openrouter.ai/settings/keys",
  },
] as const satisfies readonly ApiKeyInfo[];

export const API_KEY_IDS: readonly ApiKeyId[] = API_KEYS.map((k) => k.id);

export function apiKeyInfo(id: ApiKeyId): ApiKeyInfo {
  return API_KEYS.find((k) => k.id === id) ?? API_KEYS[0];
}

export interface ApiKeySettings {
  anthropic_api_key: string;
  groq_api_key: string;
  openai_api_key: string;
  xai_api_key: string;
  deepgram_api_key: string;
  xclis_api_key: string;
  openrouter_api_key: string;
  access_token: string;
  stt_provider: string;
}

/** Подпись запертого вендора — одна на оба пикера. */
export const MISSING_KEY_HINT = "нет ключа";

const RELAY_VENDORS = [...MODEL_PROVIDERS, ...STT_PROVIDERS];

export function hasAccessCode(settings: ApiKeySettings): boolean {
  return settings.access_token.trim() !== "";
}

/** Вендоры, до которых код доступа не дотягивается: у relay нет их роута. */
export function vendorsOutsideCode(): readonly string[] {
  return [...new Set(RELAY_VENDORS.filter((v) => !v.proxied).map((v) => v.label))];
}

/**
 * Поля ключей, которые есть смысл показывать. Код доступа стоит вместо ключа
 * каждого проксируемого вендора, поэтому под кодом остаются только ключи тех,
 * кого relay не проксирует, — а когда таких нет, полей нет вовсе.
 */
export function visibleApiKeys(settings: ApiKeySettings): readonly ApiKeyId[] {
  if (!hasAccessCode(settings)) return API_KEY_IDS;
  const outside = new Set(RELAY_VENDORS.filter((v) => !v.proxied).map((v) => v.keyId));
  return API_KEY_IDS.filter((id) => outside.has(id));
}

export function sttProvidersMissingKey(settings: ApiKeySettings): readonly string[] {
  return STT_PROVIDERS.filter((p) => {
    // Same rule as the answer vendors: a code covers only what the relay
    // proxies, and Grok speech is not among its routes.
    if (p.proxied && hasAccessCode(settings)) return false;
    return settings[`${p.keyId}_api_key`].trim() === "";
  }).map((p) => p.id);
}

/**
 * Answer-model providers the app cannot reach right now. An access code covers
 * every provider the relay proxies — Claude and GPT alike — so it unlocks both.
 */
export function modelProvidersMissingKey(settings: ApiKeySettings): readonly string[] {
  return MODEL_PROVIDERS.filter((p) => {
    // An access code covers only what the relay proxies. A vendor it does not
    // (Grok) still needs the user's own key, and the picker keeps it locked.
    if (p.proxied && hasAccessCode(settings)) return false;
    return settings[`${p.keyId}_api_key`].trim() === "";
  }).map((p) => p.id);
}

/** What still stands between the user and a working session. */
export interface AccessGap {
  kind: "answers" | "speech";
  label: string;
}

/** Answer vendors reachable right now — with a key of their own or via a code. */
export function availableAnswerProviders(settings: ApiKeySettings): readonly string[] {
  const locked = modelProvidersMissingKey(settings);
  return MODEL_PROVIDERS.filter((p) => !locked.includes(p.id)).map((p) => p.id);
}

/**
 * The two things the app genuinely needs, and neither of them names a vendor.
 *
 * It used to demand an Anthropic key specifically, from back when Claude was
 * the only way to get an answer. **Any one answer vendor is enough now** — the
 * requirement is a working pair (something to answer with, something to hear
 * with), not a particular company.
 */
export function accessGaps(settings: ApiKeySettings): AccessGap[] {
  const gaps: AccessGap[] = [];
  if (availableAnswerProviders(settings).length === 0) {
    const names = MODEL_PROVIDERS.map((p) => p.label).join(", ");
    gaps.push({
      kind: "answers",
      label: `Добавьте ключ любого провайдера ответов (${names}) или введите код доступа`,
    });
  }
  const speech = sttProviderKeyId(settings.stt_provider);
  if (sttProvidersMissingKey(settings).includes(settings.stt_provider)) {
    gaps.push({
      kind: "speech",
      label: `Добавьте ключ ${apiKeyInfo(speech).name} для распознавания речи или выберите другого провайдера`,
    });
  }
  return gaps;
}
