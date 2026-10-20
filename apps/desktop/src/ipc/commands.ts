import { getCurrentWindow } from "@tauri-apps/api/window";
import { type RequestOptions } from "@/lib/chats";
import { commands } from "./bindings";
import { type ChatMessageDto, type Settings, type UpdateInfo } from "./types";

export const {
  runPreflight,
  cancelPreflight,
  cancelPipelineRun,
  runPipelineStep,
  loadPipelines,
  savePipelines,
  getDiagnostics,
  clearDiagnostics,
  cancelStream,
  captureRegionScreenshot,
  collapseMainWindow,
  copyImageToClipboard,
  expandMainWindow,
  getAppVersion,
  getOfficialPresets,
  installUpdate,
  launchMainWindow,
  listAudioDevices,
  listModels,
  loadChats,
  loadContextLibrary,
  openExternal,
  openPermissionSettings,
  permissionsStatus,
  probeConnectivity,
  readContextImportFile,
  readContextPdfBytes,
  requestPermission,
  resetScreenPermissionAndRestart,
  retryTranscription,
  saveChats,
  saveContextLibrary,
  setPreviewHtml,
  setPttSuspended,
  setSttKeyterms,
  setWindowSize,
  stopMainWindow,
} = commands;

export async function startWindowDrag(): Promise<void> {
  await getCurrentWindow().startDragging();
}

export async function sendToClaude(
  messages: ChatMessageDto[],
  chatId: string,
  streamId: string,
  system: string,
  model: string,
  options: RequestOptions,
): Promise<void> {
  await commands.sendToClaude(messages, chatId, streamId, system, model, options);
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
