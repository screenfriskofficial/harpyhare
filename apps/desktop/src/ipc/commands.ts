import { getCurrentWindow } from "@tauri-apps/api/window";
import { normalizeAccessCode } from "@/lib/access-code";
import { type RequestOptions } from "@/lib/chats";
import { commands } from "./bindings";
import { type ChatMessageDto, type Settings, type UpdateInfo } from "./types";

const IDEMPOTENCY_STORAGE_PREFIX = "redeem-idem:";

export const {
  activatePlugin,
  cancelStream,
  captureAvailable,
  closeApp,
  getAppVersion,
  getOfficialPresets,
  hideMainWindow,
  installUpdate,
  launchMainWindow,
  listAudioOutputDevices,
  listIdentities,
  listModels,
  listPlugins,
  loadChats,
  loadContextLibrary,
  openAudioPermissionSettings,
  openExternal,
  openScreenCaptureSettings,
  probeConnectivity,
  readContextImportFile,
  readContextPdfBytes,
  requestAudioCapturePermission,
  requestScreenCapturePermission,
  retryTranscription,
  saveChats,
  saveContextLibrary,
  screenCaptureAvailable,
  setAppIdentity,
  setPreviewHtml,
  setPttSuspended,
  setWindowSize,
  stopMainWindow,
} = commands;

export async function startWindowDrag(): Promise<void> {
  await getCurrentWindow().startDragging();
}

export async function sendToClaude(
  messages: ChatMessageDto[],
  chatId: string,
  system: string,
  model: string,
  options: RequestOptions,
): Promise<void> {
  await commands.sendToClaude(messages, chatId, system, model, options);
}

export async function countChatTokens(
  messages: ChatMessageDto[],
  system: string,
  model: string,
  options: RequestOptions,
): Promise<number> {
  return commands.countChatTokens(messages, system, model, options);
}

export async function getSettings(): Promise<Settings> {
  return commands.getSettings() as Promise<Settings>;
}

export async function setSettings(newSettings: Settings): Promise<Settings> {
  return commands.setSettings(newSettings) as Promise<Settings>;
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  return commands.checkForUpdate();
}

async function idempotencyStorageKey(normalizedCode: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizedCode));
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return IDEMPOTENCY_STORAGE_PREFIX + hex.slice(0, 16);
}

export async function redeemAccessCode(code: string): Promise<string | null> {
  const normalized = normalizeAccessCode(code);
  const storageKey = await idempotencyStorageKey(normalized);
  const idempotencyKey = localStorage.getItem(storageKey) ?? crypto.randomUUID();
  localStorage.setItem(storageKey, idempotencyKey);
  try {
    await commands.redeemAccessCode(normalized, idempotencyKey);
    localStorage.removeItem(storageKey);
    return null;
  } catch (e) {
    return String(e);
  }
}
