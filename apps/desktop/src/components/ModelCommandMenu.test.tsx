import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ModelInfo } from "@/lib/models";
import {
  PROVIDER_ANTHROPIC,
  PROVIDER_OPENAI,
  STT_PROVIDER_GROQ,
  STT_PROVIDER_OPENAI,
} from "@/test/providers";
import { ModelCommandMenu } from "./ModelCommandMenu";

class ResizeObserverStub {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  globalThis.ResizeObserver = ResizeObserverStub;
});

afterEach(() => {
  cleanup();
});

const models: ModelInfo[] = [
  {
    id: "claude-opus-5",
    displayName: "Claude Opus 5",
    provider: PROVIDER_ANTHROPIC,
    adaptive: true,
    alwaysThinks: false,
    codeExec: true,
    maxInputTokens: 500000,
  },
  {
    id: "claude-haiku-4-5",
    displayName: "Claude Haiku 4.5",
    provider: PROVIDER_ANTHROPIC,
    adaptive: false,
    alwaysThinks: false,
    codeExec: false,
    maxInputTokens: 200000,
  },
];

const renderMenu = (overrides: Partial<Parameters<typeof ModelCommandMenu>[0]> = {}) => {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    sttProvider: STT_PROVIDER_GROQ,
    activeSttModelId: "openai/gpt-4o-mini-transcribe",
    sttCatalog: {
      models: [
        { id: "openai/gpt-4o-mini-transcribe", name: "OpenAI: GPT-4o Mini Transcribe" },
        { id: "mistralai/voxtral-mini-transcribe", name: "Mistral: Voxtral Mini Transcribe" },
      ],
      pending: false,
      loaded: true,
      failed: false,
      refresh: vi.fn(),
    },
    onSelectSttModel: vi.fn(),
    providersMissingKey: [] as readonly string[],
    onSwitchSttProvider: vi.fn(),
    models,
    modelProvidersMissingKey: [] as readonly string[],
    modelsPending: false,
    activeModelId: "claude-haiku-4-5",
    onSelectModel: vi.fn(),
    onRestoreFocus: vi.fn(),
    ...overrides,
  };
  render(<ModelCommandMenu {...props} />);
  return props;
};

describe("ModelCommandMenu", () => {
  it("OpenRouter opens its catalog without switching provider, then selects a model", () => {
    const props = renderMenu();
    expect(screen.queryByText("Mistral: Voxtral Mini Transcribe")).toBeNull();
    fireEvent.click(screen.getByText("OpenRouter"));
    expect(props.onSwitchSttProvider).not.toHaveBeenCalled();
    expect(props.onOpenChange).not.toHaveBeenCalled();
    expect(screen.queryByText("Opus 5")).toBeNull();
    fireEvent.click(screen.getByText("Mistral: Voxtral Mini Transcribe"));
    expect(props.onSelectSttModel).toHaveBeenCalledWith("mistralai/voxtral-mini-transcribe");
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("global search finds an OpenRouter model by ID without entering a submenu", async () => {
    const props = renderMenu();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "mistralai/voxtral" } });
    await waitFor(() => {
      expect(screen.queryByText("Opus 5")).toBeNull();
    });
    fireEvent.click(screen.getByText("Mistral: Voxtral Mini Transcribe"));
    expect(props.onSelectSttModel).toHaveBeenCalledWith("mistralai/voxtral-mini-transcribe");
    expect(props.onSelectModel).not.toHaveBeenCalled();
  });

  it("can return from the catalog with Backspace and cannot choose without a key", () => {
    const props = renderMenu({ providersMissingKey: ["openrouter"] });
    fireEvent.click(screen.getByText("OpenRouter"));
    const item = screen.getByText("Mistral: Voxtral Mini Transcribe").closest("[cmdk-item]");
    expect(item?.getAttribute("data-disabled")).toBe("true");
    if (!item) throw new Error("model row missing");
    fireEvent.click(item);
    expect(props.onSelectSttModel).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Backspace" });
    expect(screen.getByText("Opus 5")).toBeTruthy();
  });

  it("supports keyboard selection inside the catalog", async () => {
    const props = renderMenu();
    fireEvent.click(screen.getByText("OpenRouter"));
    const search = screen.getByRole("combobox");
    fireEvent.change(search, { target: { value: "Voxtral" } });
    await waitFor(() => {
      expect(screen.getAllByRole("option")).toHaveLength(1);
    });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(props.onSelectSttModel).toHaveBeenCalledWith("mistralai/voxtral-mini-transcribe");
  });

  it("показывает обе группы и все варианты", () => {
    renderMenu();
    expect(screen.getByText("Голосовая модель")).toBeTruthy();
    expect(screen.getByText("Модель ответа")).toBeTruthy();
    expect(screen.getByText("Groq · Whisper")).toBeTruthy();
    expect(screen.getByText("OpenAI · gpt-4o mini")).toBeTruthy();
    expect(screen.getByText("Opus 5")).toBeTruthy();
    expect(screen.getByText("Haiku 4.5")).toBeTruthy();
  });

  it("выбор голосовой модели переключает провайдер и закрывает меню", () => {
    const props = renderMenu();
    fireEvent.click(screen.getByText("OpenAI · gpt-4o mini"));
    expect(props.onSwitchSttProvider).toHaveBeenCalledWith(STT_PROVIDER_OPENAI);
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(props.onSelectModel).not.toHaveBeenCalled();
  });

  it("доступная модель идёт без замка", () => {
    renderMenu();
    const item = screen.getByText("Opus 5").closest("[data-slot=command-item]");
    expect(item?.querySelector("svg.lucide-lock")).toBeNull();
  });

  it("выбор модели ответа отдаёт id и закрывает меню", () => {
    const props = renderMenu();
    fireEvent.click(screen.getByText("Opus 5"));
    expect(props.onSelectModel).toHaveBeenCalledWith("claude-opus-5");
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(props.onSwitchSttProvider).not.toHaveBeenCalled();
  });

  it("модель чата вне каталога всё равно попадает в список", () => {
    renderMenu({ activeModelId: "claude-sonnet-4" });
    expect(screen.getByText("claude-sonnet-4")).toBeTruthy();
  });

  it("модели двух провайдеров идут отдельными группами с именем вендора", () => {
    renderMenu({
      models: [
        ...models,
        {
          id: "gpt-5.6-terra",
          displayName: "GPT-5.6 Terra",
          provider: PROVIDER_OPENAI,
          adaptive: true,
          alwaysThinks: false,
          codeExec: true,
          maxInputTokens: 0,
        },
      ],
    });
    expect(screen.getByText("Модель ответа · Claude")).toBeTruthy();
    expect(screen.getByText("Модель ответа · OpenAI")).toBeTruthy();
    expect(screen.queryByText("Модель ответа")).toBeNull();
    expect(screen.getByText("GPT-5.6 Terra")).toBeTruthy();
  });

  it("без ключа модели вендора видны, но с подсказкой и не выбираются", () => {
    const props = renderMenu({
      models: [
        ...models,
        {
          id: "gpt-5.6-terra",
          displayName: "GPT-5.6 Terra",
          provider: PROVIDER_OPENAI,
          adaptive: true,
          alwaysThinks: false,
          codeExec: true,
          maxInputTokens: 0,
        },
      ],
      modelProvidersMissingKey: [PROVIDER_OPENAI],
    });
    const item = screen.getByText("GPT-5.6 Terra").closest("[data-slot=command-item]");
    expect(item?.getAttribute("data-disabled")).toBe("true");
    expect(item?.querySelector("svg.lucide-lock")).toBeTruthy();
    expect(screen.getAllByText("нет ключа").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("GPT-5.6 Terra"));
    expect(props.onSelectModel).not.toHaveBeenCalled();
  });

  it("выбор модели OpenAI отдаёт её id", () => {
    const props = renderMenu({
      models: [
        {
          id: "gpt-5.6-terra",
          displayName: "GPT-5.6 Terra",
          provider: PROVIDER_OPENAI,
          adaptive: true,
          alwaysThinks: false,
          codeExec: true,
          maxInputTokens: 0,
        },
      ],
      modelsPending: false,
      activeModelId: "gpt-5.6-terra",
    });
    fireEvent.click(screen.getByText("GPT-5.6 Terra"));
    expect(props.onSelectModel).toHaveBeenCalledWith("gpt-5.6-terra");
  });
});

describe("ModelCommandMenu пока каталог не пришёл", () => {
  it("не раскладывает модели по группам и показывает заглушки", () => {
    // Вшитый список не знает моделей вендора с динамическим каталогом, поэтому
    // выбранная модель попала бы в «Другие» и прыгнула бы в свою группу, когда
    // приедет живой список. Пока данные предварительные — группы не строим.
    renderMenu({ modelsPending: true, activeModelId: "xclis/claude-sonnet-5" });
    // Неизвестная выбранная модель не выдумывает себе группу «Другие»…
    expect(screen.queryByText("Другие")).toBeNull();
    expect(screen.getByText("xclis/claude-sonnet-5")).toBeTruthy();
    expect(document.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("уже известные модели остаются доступными, пока каталог грузится", () => {
    // Прятать их ради ещё не пришедшего динамического каталога значит
    // заблокировать заведомо рабочий выбор — ровно это и было регрессией.
    renderMenu({ modelsPending: true, activeModelId: "xclis/claude-sonnet-5" });
    const known = screen.getByText(/Haiku/).closest("[data-slot='command-item']");
    expect(known?.getAttribute("data-disabled")).not.toBe("true");
  });

  it("с пришедшим каталогом заглушек нет", () => {
    renderMenu({ modelsPending: false });
    expect(document.querySelectorAll(".animate-pulse").length).toBe(0);
  });
});
