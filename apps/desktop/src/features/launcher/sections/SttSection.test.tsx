import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/ipc/types";
import type { PermissionsApi } from "@/hooks/usePermissions";
import type { SetSetting } from "../contract";

vi.mock("./AudioRouting", () => ({ AudioRouting: () => null }));
vi.mock("./AudioSources", () => ({ AudioSources: () => null }));
vi.mock("@/hooks/useSttModels", () => ({
  useSttModels: () => ({
    models: [
      { id: "openai/gpt-4o-mini-transcribe", name: "OpenAI: GPT-4o Mini Transcribe" },
      { id: "mistralai/voxtral", name: "Mistral: Voxtral" },
    ],
    loaded: true,
    pending: false,
    failed: false,
    refresh: vi.fn(),
  }),
}));
import { SttSection } from "./SttSection";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(provider: string) {
  const set = vi.fn<SetSetting>();
  // Source controls are tested separately and do not participate in model selection.
  const permissions = {} as PermissionsApi;
  render(
    <SttSection
      draft={{ ...DEFAULT_SETTINGS, stt_provider: provider }}
      set={set}
      permissions={permissions}
    />,
  );
  return set;
}

describe("STT model settings", () => {
  it("shows a searchable model field for OpenRouter and persists the selected ID", async () => {
    const set = setup("openrouter");
    fireEvent.click(screen.getByRole("combobox", { name: "Модель OpenRouter" }));
    fireEvent.change(screen.getByPlaceholderText("Найти модель распознавания…"), {
      target: { value: "mistralai/voxtral" },
    });
    await waitFor(() => {
      expect(screen.getAllByRole("option")).toHaveLength(1);
    });
    fireEvent.click(screen.getByText("Mistral: Voxtral"));
    expect(set).toHaveBeenCalledWith("openrouter_stt_model", "mistralai/voxtral");
  });
  it("keeps fixed-model providers simple and supports searching providers", async () => {
    const set = setup("groq");
    expect(screen.queryByRole("combobox", { name: "Модель OpenRouter" })).toBeNull();
    fireEvent.click(screen.getByRole("combobox", { name: "Провайдер распознавания" }));
    fireEvent.change(screen.getByPlaceholderText("Найти провайдера…"), {
      target: { value: "openrouter" },
    });
    await waitFor(() => {
      expect(screen.getAllByRole("option")).toHaveLength(1);
    });
    fireEvent.click(screen.getByText("OpenRouter"));
    expect(set).toHaveBeenCalledWith("stt_provider", "openrouter");
  });
});
