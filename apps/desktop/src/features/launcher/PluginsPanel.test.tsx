import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginDescriptor } from "@/ipc/bindings";
import { DEFAULT_SETTINGS, type Settings } from "@/ipc/types";

const listPlugins = vi.fn<() => Promise<PluginDescriptor[]>>();
vi.mock("@/ipc/commands", () => ({ listPlugins: () => listPlugins() }));

import { PluginsPanel } from "./PluginsPanel";

afterEach(() => {
  vi.clearAllMocks();
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

describe("PluginsPanel", () => {
  it("рисует плагин и переключение вызывает set с полной записью", async () => {
    listPlugins.mockResolvedValue([
      {
        id: "harpyshot",
        name: "harpyshot",
        description: "d",
        version: "1.0.0",
        icon: "crop",
        capability: "attachment_source",
        permissions: [],
        enabled: false,
        hotkey: "Cmd+Shift+S",
        state: "ready",
      },
    ]);
    const set = vi.fn();
    const draft: Settings = { ...DEFAULT_SETTINGS };
    render(createElement(PluginsPanel, { draft, set }), { wrapper });
    const card = await screen.findByText("harpyshot");
    act(() => {
      card.click();
    });
    const toggle = await screen.findByRole("switch");
    act(() => {
      toggle.click();
    });
    expect(set).toHaveBeenCalledWith("plugin_settings", [
      { id: "harpyshot", enabled: true, hotkey: "Cmd+Shift+S" },
    ]);
  });
});
