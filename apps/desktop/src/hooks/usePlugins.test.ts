import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginDescriptor } from "@/ipc/bindings";

const listPlugins = vi.fn<() => Promise<PluginDescriptor[]>>();
vi.mock("@/ipc/commands", () => ({ listPlugins: () => listPlugins() }));

const handlers = new Map<string, (p: unknown) => void>();
vi.mock("@/ipc/events", () => ({
  onEvent: (name: string, h: (p: unknown) => void) => {
    handlers.set(name, h);
    return () => {
      handlers.delete(name);
    };
  },
}));

import { usePlugins } from "./usePlugins";

afterEach(() => {
  vi.clearAllMocks();
  handlers.clear();
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

describe("usePlugins", () => {
  it("отдаёт список из list_plugins и роутит plugin-result image в onImage", async () => {
    listPlugins.mockResolvedValue([
      {
        id: "harpyshot",
        name: "harpyshot",
        description: "d",
        version: "1.0.0",
        icon: "crop",
        capability: "attachment_source",
        permissions: [],
        enabled: true,
        hotkey: "Cmd+Shift+S",
        state: "ready",
      },
    ]);
    const onImage = vi.fn();
    const { result } = renderHook(() => usePlugins(onImage), { wrapper });
    await waitFor(() => {
      expect(result.current).toHaveLength(1);
    });
    handlers.get("plugin-result")?.({
      pluginId: "harpyshot",
      kind: "image",
      mediaType: "image/png",
      dataBase64: "AAAA",
      text: null,
    });
    expect(onImage).toHaveBeenCalledWith("data:image/png;base64,AAAA", "image/png");
  });
});
