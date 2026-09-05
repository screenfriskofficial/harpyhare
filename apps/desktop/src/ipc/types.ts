import type { ImagePayload } from "@/lib/composer";
import type { AppError } from "@/lib/errors";
import type { PromptPreset } from "@/lib/presets";
import type { TranscriptReady } from "./bindings";
import { SETTINGS_DEFAULTS } from "./bindings";

export type { AppError, ImagePayload };

export interface HotkeyBinding {
  action: string;
  combo: string;
}

export interface QuickAction {
  id: string;
  title: string;
  prompt: string;
}

export interface Settings {
  anthropic_api_key: string;
  groq_api_key: string;
  openai_api_key: string;
  xai_api_key: string;
  deepgram_api_key: string;
  openrouter_api_key: string;
  xclis_api_key: string;
  access_token: string;
  prompt_presets: PromptPreset[];
  hotkeys: HotkeyBinding[];
  auto_send: boolean;
  window_opacity: number;
  move_step: number;
  auto_preview_html: boolean;
  chat_font_size: number;
  skipped_version: string;
  stt_language: string;
  stt_translate: boolean;
  stt_provider: string;
  openrouter_stt_model: string;
  screen_share_visible: boolean;
  teleprompter_speed: number;
  teleprompter_font_size: number;
  teleprompter_resume: boolean;
  audio_permission_requested: boolean;
  screen_permission_requested: boolean;
  window_width: number;
  window_height: number;
  resize_step: number;
  capture_device_uid: string;
  microphone_device_uid: string;
  capture_system_audio: boolean;
  capture_microphone: boolean;
  theme: string;
  ui_language: string;
  scroll_step: number;
  buffer_enabled: boolean;
  buffer_seconds: number;
  quick_actions: QuickAction[];
  quick_action_attachments: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  ...SETTINGS_DEFAULTS,
  prompt_presets: [...SETTINGS_DEFAULTS.prompt_presets],
  hotkeys: [...SETTINGS_DEFAULTS.hotkeys],
  quick_actions: [...SETTINGS_DEFAULTS.quick_actions],
};

export interface AudioDeviceInfo {
  uid: string;
  name: string;
  is_default: boolean;
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
  "transcript-ready": TranscriptReady;
  "stt-error": AppError;
  "llm-delta": { chatId: string; streamId: string; delta: string };
  "llm-done": { chatId: string; streamId: string };
  "llm-error": AppError & { chatId: string; streamId: string };
  "llm-usage": { chatId: string; streamId: string; inputTokens: number };
  "update-available": UpdateInfo;
  "update-progress": UpdateProgress;
  "update-done": { version: string };
  "toggle-teleprompter": null;
  "toggle-mini": null;
  "resize-key": { dim: "width" | "height"; dir: 1 | -1 };
  "official-presets-updated": PromptPreset[];
  "screenshot-ready": { mediaType: string; dataBase64: string };
  "screenshot-error": AppError;
  "focus-prompt": null;
  "duplicate-chat": null;
  "hotkey-error": AppError;
}
