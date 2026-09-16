import { t } from "@/i18n";
import type { Attachment, ImagePayload } from "@/lib/composer";
import { DEFAULT_MODEL } from "@/lib/models";
import type { PreparedContext } from "@/lib/pipeline-types";
import { isRecord } from "@/lib/utils";

export const CHAT_LIMIT = 6;
const TITLE_MAX = 22;
const TITLE_ELLIPSIS = "…";
const NO_PRESET_ID = "";

export type Role = "user" | "assistant";

export interface ChatMessage {
  role: Role;
  text: string;
  images: ImagePayload[];
  /**
   * How many images this message carried before a restart dropped them.
   * `serializeChats` strips image bytes to keep `chats.json` small; the bubble
   * uses this count to say so, instead of silently showing text alone as if
   * the model had never been shown anything.
   */
  droppedImages?: number;
}

export interface RequestOptions {
  thinking: boolean;
  webSearch: boolean;
}

export interface Chat {
  id: string;
  title: string;
  messages: ChatMessage[];
  draft: string;
  draftAttachments: Attachment[];
  titlePinned: boolean;
  presetId: string;
  thinkingEnabled: boolean;
  model: string;
  webSearch: boolean;
  context: string;
  promptPipelineId?: string;
  messagePipelineId?: string;
  preparedPrompt?: PreparedPrompt;
}

/** A chat's cached preparation: reused while the fingerprint of everything the pipeline read still matches. */
export interface PreparedPrompt extends PreparedContext {
  pipelineId: string;
  fingerprint: string;
}

const NEW_CHAT_DEFAULTS = {
  draft: "",
  titlePinned: false,
  presetId: NO_PRESET_ID,
  thinkingEnabled: false,
  model: DEFAULT_MODEL,
  webSearch: false,
  context: "",
} satisfies Partial<Chat>;

function uid(): string {
  return crypto.randomUUID();
}

function indexedChatTitle(index: number): string {
  return t("chats.numbered", { number: index });
}

export function createChat(index: number, id: string = uid()): Chat {
  return {
    id,
    title: indexedChatTitle(index),
    messages: [],
    draftAttachments: [],
    // Массивы — свои у каждого чата: общая ссылка из константы делила бы их между чатами.
    ...NEW_CHAT_DEFAULTS,
  };
}

/** Заглушка «активного чата», пока список с диска ещё не пришёл. */
export const EMPTY_CHAT: Chat = { ...createChat(0, ""), title: "" };

export function createChatFrom(source: Chat, index: number, id: string = uid()): Chat {
  return {
    ...createChat(index, id),
    presetId: source.presetId,
    thinkingEnabled: source.thinkingEnabled,
    model: source.model,
    webSearch: source.webSearch,
    context: source.context,
    promptPipelineId: source.promptPipelineId,
    messagePipelineId: source.messagePipelineId,
    preparedPrompt: source.preparedPrompt,
  };
}

export type ChatPatch = Partial<
  Pick<
    Chat,
    | "draft"
    | "draftAttachments"
    | "presetId"
    | "thinkingEnabled"
    | "model"
    | "webSearch"
    | "context"
    | "promptPipelineId"
    | "messagePipelineId"
    | "preparedPrompt"
  >
>;

/** Present only when there is something to report: a zero would only bloat the file. */
function droppedImagesField(count: number): Pick<ChatMessage, "droppedImages"> {
  return count > 0 ? { droppedImages: count } : {};
}

export function chatRequestOptions(chat: Chat): RequestOptions {
  return { thinking: chat.thinkingEnabled, webSearch: chat.webSearch };
}

export function chatTitle(firstUserText: string, index: number): string {
  const trimmed = firstUserText.trim();
  if (trimmed === "") return indexedChatTitle(index);
  // Считаем кодовые точки, а не UTF-16-единицы: срез посреди эмодзи оставил бы одинокий суррогат.
  const codePoints = Array.from(trimmed);
  return codePoints.length > TITLE_MAX
    ? `${codePoints.slice(0, TITLE_MAX).join("")}${TITLE_ELLIPSIS}`
    : trimmed;
}

export function serializeChats(chats: Chat[]): string {
  const withoutImages = chats.map((c) => ({
    id: c.id,
    title: c.title,
    titlePinned: c.titlePinned,
    presetId: c.presetId,
    thinkingEnabled: c.thinkingEnabled,
    model: c.model,
    webSearch: c.webSearch,
    context: c.context,
    promptPipelineId: c.promptPipelineId,
    messagePipelineId: c.messagePipelineId,
    preparedPrompt: c.preparedPrompt,
    messages: c.messages.map((m) => ({
      role: m.role,
      text: m.text,
      images: [],
      ...droppedImagesField(m.images.length + (m.droppedImages ?? 0)),
    })),
    draft: c.draft,
    draftAttachments: [],
  }));
  return JSON.stringify(withoutImages);
}

function restoreMessage(raw: unknown): ChatMessage | null {
  if (!isRecord(raw)) return null;
  const m = raw as Partial<ChatMessage>;
  const dropped =
    typeof m.droppedImages === "number" && Number.isFinite(m.droppedImages)
      ? Math.max(0, Math.floor(m.droppedImages))
      : 0;
  return {
    role: m.role === "assistant" ? "assistant" : "user",
    text: typeof m.text === "string" ? m.text : "",
    images: [],
    ...droppedImagesField(dropped),
  };
}

function restoreChat(c: unknown): Chat | null {
  if (!isRecord(c)) return null;
  const o = c as Partial<Chat>;
  return {
    id: typeof o.id === "string" ? o.id : uid(),
    title: typeof o.title === "string" ? o.title : t("chats.untitled"),
    titlePinned: typeof o.titlePinned === "boolean" ? o.titlePinned : NEW_CHAT_DEFAULTS.titlePinned,
    presetId: typeof o.presetId === "string" ? o.presetId : NO_PRESET_ID,
    promptPipelineId: restorePipelineId(o.promptPipelineId),
    messagePipelineId: restorePipelineId(o.messagePipelineId),
    preparedPrompt: restorePreparedPrompt(o.preparedPrompt),
    thinkingEnabled:
      typeof o.thinkingEnabled === "boolean"
        ? o.thinkingEnabled
        : NEW_CHAT_DEFAULTS.thinkingEnabled,
    model: typeof o.model === "string" && o.model !== "" ? o.model : NEW_CHAT_DEFAULTS.model,
    webSearch: typeof o.webSearch === "boolean" ? o.webSearch : NEW_CHAT_DEFAULTS.webSearch,
    context: typeof o.context === "string" ? o.context : NEW_CHAT_DEFAULTS.context,
    messages: Array.isArray(o.messages)
      ? o.messages.flatMap((m: unknown) => restoreMessage(m) ?? [])
      : [],
    draft: typeof o.draft === "string" ? o.draft : NEW_CHAT_DEFAULTS.draft,
    draftAttachments: [],
  };
}

/** "No pipeline" is the absent field; an empty id written by an older build reads the same. */
function restorePipelineId(raw: unknown): string | undefined {
  return typeof raw === "string" && raw !== "" ? raw : undefined;
}

function restorePreparedPrompt(raw: unknown): PreparedPrompt | undefined {
  if (!isRecord(raw)) return undefined;
  const value = raw as Partial<PreparedPrompt>;
  if (
    typeof value.pipelineId !== "string" ||
    typeof value.fingerprint !== "string" ||
    typeof value.text !== "string" ||
    !Array.isArray(value.keywordSources)
  )
    return undefined;
  return {
    pipelineId: value.pipelineId,
    fingerprint: value.fingerprint,
    text: value.text,
    keywordSources: value.keywordSources.filter((item): item is string => typeof item === "string"),
  };
}

export function deserializeChats(json: string): Chat[] | null {
  if (json.trim() === "") return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(raw)) return null;
  const chats = raw.flatMap((c: unknown) => restoreChat(c) ?? []);
  return chats.length === 0 ? null : chats;
}
