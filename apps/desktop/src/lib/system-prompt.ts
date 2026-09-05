import type { Chat } from "./chats";
import { libraryContextBlocks, type ContextLibrary } from "./context-library";
import { stripKeywordBlocks } from "./keywords";
import { presetText, type PromptPreset } from "./presets";

const USER_CONTEXT_SYSTEM_HEADER = "Контекст от пользователя (справочные материалы):\n";
const SYSTEM_BLOCKS_SEPARATOR = "\n\n";

export type PromptChat = Pick<Chat, "presetId" | "libraryDocIds" | "context">;

/** Every piece of text a chat contributes to its system prompt, raw. */
export function chatPromptSources(
  presets: PromptPreset[],
  chat: PromptChat,
  library: ContextLibrary,
): string[] {
  const context = chat.context.trim();
  return [
    presetText(presets, chat.presetId),
    ...libraryContextBlocks(library, chat.libraryDocIds),
    context === "" ? "" : `${USER_CONTEXT_SYSTEM_HEADER}${context}`,
  ].filter((s) => s !== "");
}

/**
 * `[keywords]: [...]` declarations are stripped here: they configure speech
 * recognition, and the answering model has no business being handed a
 * directive it is expected to ignore.
 */
export function chatSystemPrompt(sources: readonly string[]): string {
  return sources
    .map(stripKeywordBlocks)
    .filter((s) => s !== "")
    .join(SYSTEM_BLOCKS_SEPARATOR);
}
