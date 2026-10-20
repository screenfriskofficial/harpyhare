import { t } from "@/i18n";
import { MODEL_PROVIDERS } from "./models";
import { STT_PROVIDERS, sttProviderKeyId } from "./stt-providers";

export type ApiKeyId = "anthropic" | "openai" | "deepgram";

export interface ApiKeyInfo {
  id: ApiKeyId;
  name: string;
  /** Чем занят ключ, в родительном падеже: «Нужен для …». Из словаря по `id`. */
  purpose: string;
  consoleUrl: string;
}

/** Реестр без текста: имя — бренд, назначение переводится по `id`. */
const API_KEYS = [
  { id: "anthropic", name: "Anthropic", consoleUrl: "https://console.anthropic.com/settings/keys" },
  { id: "openai", name: "OpenAI", consoleUrl: "https://platform.openai.com/api-keys" },
  { id: "deepgram", name: "Deepgram", consoleUrl: "https://console.deepgram.com/" },
] as const satisfies readonly Omit<ApiKeyInfo, "purpose">[];

export const API_KEY_IDS: readonly ApiKeyId[] = API_KEYS.map((k) => k.id);

export function apiKeyInfo(id: ApiKeyId): ApiKeyInfo {
  const key = API_KEYS.find((k) => k.id === id) ?? API_KEYS[0];
  return { ...key, purpose: t(`apiKeys.purposes.${key.id}`) };
}

export interface ApiKeySettings {
  anthropic_api_key: string;
  openai_api_key: string;
  deepgram_api_key: string;
  stt_provider: string;
}

/** Подпись запертого вендора — одна на оба пикера. */
export function missingKeyHint(): string {
  return t("apiKeys.missingKey");
}

function hasKey(settings: ApiKeySettings, keyId: ApiKeyId): boolean {
  return settings[`${keyId}_api_key`].trim() !== "";
}

export function sttProvidersMissingKey(settings: ApiKeySettings): readonly string[] {
  return STT_PROVIDERS.filter((p) => !hasKey(settings, p.keyId)).map((p) => p.id);
}

/** Answer-model providers the app cannot reach right now: no key of their own. */
export function modelProvidersMissingKey(settings: ApiKeySettings): readonly string[] {
  return MODEL_PROVIDERS.filter((p) => !hasKey(settings, p.keyId)).map((p) => p.id);
}

/** What still stands between the user and a working session. */
export interface AccessGap {
  kind: "answers" | "speech";
  label: string;
}

/** Answer vendors reachable right now. */
export function availableAnswerProviders(settings: ApiKeySettings): readonly string[] {
  const locked = modelProvidersMissingKey(settings);
  return MODEL_PROVIDERS.filter((p) => !locked.includes(p.id)).map((p) => p.id);
}

/**
 * The two things the app genuinely needs, and neither of them names a vendor.
 *
 * It used to demand an Anthropic key specifically, from back when Claude was
 * the only way to get an answer. **Any one answer vendor is enough** — the
 * requirement is a working pair (something to answer with, something to hear
 * with), not a particular company.
 */
export function accessGaps(settings: ApiKeySettings): AccessGap[] {
  const gaps: AccessGap[] = [];
  if (availableAnswerProviders(settings).length === 0) {
    const names = MODEL_PROVIDERS.map((p) => p.label).join(", ");
    gaps.push({
      kind: "answers",
      label: t("apiKeys.gaps.answers", { names }),
    });
  }
  const speech = sttProviderKeyId(settings.stt_provider);
  if (!hasKey(settings, speech)) {
    gaps.push({
      kind: "speech",
      label: t("apiKeys.gaps.speech", { name: apiKeyInfo(speech).name }),
    });
  }
  return gaps;
}
