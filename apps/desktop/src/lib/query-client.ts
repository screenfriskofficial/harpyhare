import { QueryClient } from "@tanstack/react-query";
import type { RequestOptions } from "@/lib/chats";

const DEFAULT_STALE_MS = 5 * 60 * 1000;
const DEFAULT_GC_MS = 30 * 60 * 1000;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: DEFAULT_STALE_MS,
        gcTime: DEFAULT_GC_MS,
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    },
  });
}

export const queryKeys = {
  models: ["models"] as const,
  openrouterSttModels: ["stt-models", "openrouter"] as const,
  officialPresets: ["official-presets"] as const,
  audioDevices: ["audio-devices"] as const,
  countTokens: (
    chatId: string,
    model: string,
    options: RequestOptions,
    systemDigest: string,
    messagesKey: string,
  ) =>
    [
      "count-tokens",
      chatId,
      model,
      options.thinking,
      options.webSearch,
      systemDigest,
      messagesKey,
    ] as const,
};
