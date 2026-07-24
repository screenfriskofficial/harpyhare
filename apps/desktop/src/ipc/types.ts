import type { ImagePayload } from "@/lib/composer";
import type { AppError } from "@/lib/errors";
import type { PromptPreset } from "@/lib/presets";
import { SETTINGS_DEFAULTS } from "./bindings";

export type { AppError, ImagePayload };

export interface PluginSetting {
  id: string;
  enabled: boolean;
  hotkey: string;
}

export interface Settings {
  anthropic_api_key: string;
  groq_api_key: string;
  access_token: string;
  prompt_presets: PromptPreset[];
  hotkey: string;
  auto_send: boolean;
  window_opacity: number;
  move_step: number;
  auto_preview_html: boolean;
  toggle_hotkey: string;
  chat_font_size: number;
  skipped_version: string;
  stt_language: string;
  stt_translate: boolean;
  screen_share_visible: boolean;
  teleprompter_speed: number;
  teleprompter_font_size: number;
  teleprompter_hotkey: string;
  teleprompter_resume: boolean;
  window_width: number;
  window_height: number;
  resize_step: number;
  capture_device_uid: string;
  theme: string;
  scroll_step: number;
  buffer_enabled: boolean;
  buffer_seconds: number;
  identity_id: string;
  move_modifier: string;
  resize_modifier: string;
  scroll_modifier: string;
  plugin_settings: PluginSetting[];
}

export const DEFAULT_SETTINGS: Settings = {
  ...SETTINGS_DEFAULTS,
  prompt_presets: [...SETTINGS_DEFAULTS.prompt_presets],
  plugin_settings: [...SETTINGS_DEFAULTS.plugin_settings],
};

export interface AudioOutputDevice {
  uid: string;
  name: string;
}

export interface IdentityInfo {
  id: string;
  displayName: string;
  iconPngBase64: string;
}

export type RecorderState = "idle" | "recording" | "transcribing";

export interface ChatMessageDto {
  role: "user" | "assistant";
  text: string;
  images: ImagePayload[];
}

export interface UpdateInfo {
  version: string;
  notes: string;
  date: string | null;
}

export interface UpdateProgress {
  downloaded: number;
  total: number | null;
}

export interface EventMap {
  "state-changed": RecorderState;
  "transcript-ready": string;
  "stt-error": AppError;
  "llm-delta": { chatId: string; delta: string };
  "llm-done": { chatId: string };
  "llm-error": AppError & { chatId: string };
  "llm-usage": { chatId: string; inputTokens: number };
  "update-available": UpdateInfo;
  "update-progress": UpdateProgress;
  "update-done": { version: string };
  "toggle-teleprompter": null;
  "resize-key": { dim: "width" | "height"; dir: 1 | -1 };
  "official-presets-updated": PromptPreset[];
}
