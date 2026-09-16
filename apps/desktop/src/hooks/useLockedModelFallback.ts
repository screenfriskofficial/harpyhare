import { useEffect, useMemo } from "react";
import type { Settings } from "@/ipc/types";
import { modelProvidersMissingKey, sttProvidersMissingKey } from "@/lib/api-keys";
import type { ChatPatch } from "@/lib/chats";
import { defaultModelFor, type ModelInfo } from "@/lib/models";

export interface LockedModelFallbackInput {
  settings: Settings;
  settingsLoading: boolean;
  models: ModelInfo[];
  chatId: string;
  chatModel: string;
  patchChat: (id: string, patch: ChatPatch) => void;
}

export interface LockedProviders {
  lockedAnswerProviders: readonly string[];
  lockedSttProviders: readonly string[];
}

/**
 * Which vendors the pickers show locked — and the one consequence of a lock.
 * A vendor's key may be removed (or the access code unlinked) after a chat
 * has settled on its model: the picker draws such a model locked, but it
 * stayed SELECTED, and a send went to a foreign provider with an id it did
 * not know. The chat is moved onto a model the user can actually call.
 */
export function useLockedModelFallback({
  settings,
  settingsLoading,
  models,
  chatId,
  chatModel,
  patchChat,
}: LockedModelFallbackInput): LockedProviders {
  const lockedSttProviders = useMemo(() => sttProvidersMissingKey(settings), [settings]);
  const lockedAnswerProviders = useMemo(() => modelProvidersMissingKey(settings), [settings]);

  useEffect(() => {
    if (settingsLoading) return;
    const owner = models.find((m) => m.id === chatModel)?.provider;
    if (owner === undefined || !lockedAnswerProviders.includes(owner)) return;
    patchChat(chatId, { model: defaultModelFor(lockedAnswerProviders, models) });
  }, [settingsLoading, models, chatModel, chatId, lockedAnswerProviders, patchChat]);

  return { lockedAnswerProviders, lockedSttProviders };
}
