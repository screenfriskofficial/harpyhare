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
  officialPresets: ["official-presets"] as const,
  audioDevices: ["audio-devices"] as const,
  identities: ["identities"] as const,
  plugins: ["plugins"] as const,
  countTokens: (model: string, options: RequestOptions, system: string, messagesKey: string) =>
    ["count-tokens", model, options.thinking, options.webSearch, system, messagesKey] as const,
};
