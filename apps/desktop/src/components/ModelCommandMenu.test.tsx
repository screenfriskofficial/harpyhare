import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogFailure } from "@/ipc/bindings";
import type { ModelInfo } from "@/lib/models";
import { PROVIDER_ANTHROPIC, PROVIDER_OPENAI, STT_PROVIDER_DEEPGRAM } from "@/test/providers";
import { ModelCommandMenu } from "./ModelCommandMenu";

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
    efforts: [],
    budgetThinking: false,
    defaultEffort: null,
  },
  {
    id: "claude-haiku-4-5",
    displayName: "Claude Haiku 4.5",
    provider: PROVIDER_ANTHROPIC,
    adaptive: false,
    alwaysThinks: false,
    codeExec: false,
    efforts: [],
    budgetThinking: false,
    defaultEffort: null,
  },
];

const renderMenu = (overrides: Partial<Parameters<typeof ModelCommandMenu>[0]> = {}) => {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    sttProvider: STT_PROVIDER_DEEPGRAM,
    providersMissingKey: [] as readonly string[],
    onSwitchSttProvider: vi.fn(),
    models,
    modelProvidersMissingKey: [] as readonly string[],
    modelsPending: false,
    catalogFailures: [] as readonly CatalogFailure[],
    activeModelId: "claude-haiku-4-5",
    onSelectModel: vi.fn(),
    onRestoreFocus: vi.fn(),
    ...overrides,
  };
  render(<ModelCommandMenu {...props} />);
  return props;
};

describe("ModelCommandMenu", () => {
  it("показывает обе группы и все варианты", () => {
    renderMenu();
    expect(screen.getByText("Голосовая модель")).toBeTruthy();
    // One answer vendor in the list: the heading names no vendor.
    expect(screen.getByText("Модель ответа")).toBeTruthy();
    expect(screen.getByText("Deepgram · Nova-3")).toBeTruthy();
    expect(screen.getByText("Opus 5")).toBeTruthy();
    expect(screen.getByText("Haiku 4.5")).toBeTruthy();
  });

  it("выбор голосовой модели переключает провайдер и закрывает меню", () => {
    const props = renderMenu();
    fireEvent.click(screen.getByText("Deepgram · Nova-3"));
    expect(props.onSwitchSttProvider).toHaveBeenCalledWith(STT_PROVIDER_DEEPGRAM);
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(props.onSelectModel).not.toHaveBeenCalled();
  });

  it("вендор, чей каталог не пришёл, подписан причиной, а его модели остаются", () => {
    renderMenu({
      catalogFailures: [
        {
          provider: PROVIDER_ANTHROPIC,
          error: { code: "badApiKey", message: "Неверный ключ Anthropic" },
        },
      ],
    });
    const note = screen.getByRole("note");
    expect(note.textContent).toContain("Список не обновился");
    expect(screen.getByText("Opus 5")).toBeTruthy();
  });

  it("без сбоев подписи нет", () => {
    renderMenu();
    expect(screen.queryByRole("note")).toBeNull();
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
          efforts: [],
          budgetThinking: false,
          defaultEffort: null,
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
          efforts: [],
          budgetThinking: false,
          defaultEffort: null,
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
          efforts: [],
          budgetThinking: false,
          defaultEffort: null,
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
    // Вшитый список знает не все модели живого каталога, поэтому выбранная
    // модель попала бы в «Другие» и прыгнула бы в свою группу, когда приедет
    // живой список. Пока данные предварительные — группы не строим.
    renderMenu({ modelsPending: true, activeModelId: "claude-sonnet-4-5" });
    // Неизвестная выбранная модель не выдумывает себе группу «Другие»…
    expect(screen.queryByText("Другие")).toBeNull();
    expect(screen.getByText("claude-sonnet-4-5")).toBeTruthy();
    expect(document.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("уже известные модели остаются доступными, пока каталог грузится", () => {
    // Прятать их ради ещё не пришедшего живого каталога значит
    // заблокировать заведомо рабочий выбор — ровно это и было регрессией.
    renderMenu({ modelsPending: true, activeModelId: "claude-sonnet-4-5" });
    const known = screen.getByText(/Haiku/).closest("[data-slot='command-item']");
    expect(known?.getAttribute("data-disabled")).not.toBe("true");
  });

  it("с пришедшим каталогом заглушек нет", () => {
    renderMenu({ modelsPending: false });
    expect(document.querySelectorAll(".animate-pulse").length).toBe(0);
  });
});
