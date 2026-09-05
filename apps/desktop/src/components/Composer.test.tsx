import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Composer, type ComposerProps } from "./Composer";
import { createChat } from "@/lib/chats";
import { UiProviders } from "@/test/ui-wrapper";
import { EMPTY_LIBRARY } from "@/lib/context-library";
import { FALLBACK_MODELS, type ModelInfo } from "@/lib/models";
import { PROVIDER_ANTHROPIC, PROVIDER_OPENAI } from "@/test/providers";

const CLAUDE_ONLY = FALLBACK_MODELS.filter((m) => m.provider === PROVIDER_ANTHROPIC);

const PLACEHOLDER = "Расшифровка появится здесь — или напиши вопрос сам";

const GPT: ModelInfo = {
  id: "gpt-5.6-terra",
  displayName: "GPT-5.6 Terra",
  provider: PROVIDER_OPENAI,
  adaptive: true,
  alwaysThinks: false,
  codeExec: true,
  maxInputTokens: 0,
};

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
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

function renderComposer(overrides: Partial<ComposerProps> = {}) {
  const onSend = vi.fn();
  const props: ComposerProps = {
    chat: { ...createChat(1, "c1"), draft: "вопрос" },
    onPatch: vi.fn(),
    onRemoveAttachment: vi.fn(),
    onPaste: vi.fn(),
    onSend,
    onStop: vi.fn(),
    onClearHistory: vi.fn(),
    onRetry: vi.fn(),
    onRestoreFocus: vi.fn(),
    retryLabel: "Повторить",
    streaming: false,
    showRetry: false,
    presets: [],
    library: EMPTY_LIBRARY,
    models: CLAUDE_ONLY,
    modelProvidersMissingKey: [] as readonly string[],
    onCaptureRegion: vi.fn(),
    promptRef: createRef<HTMLTextAreaElement>(),
    quickActions: [],
    quickActionCombo: "",
    onQuickAction: vi.fn(),
    ...overrides,
  };
  render(<Composer {...props} />, { wrapper: UiProviders });
  return {
    onSend,
    onPatch: props.onPatch,
    field: screen.getByPlaceholderText<HTMLTextAreaElement>(PLACEHOLDER),
  };
}

function openModelSelect() {
  fireEvent.click(screen.getByLabelText("Параметры запроса"));
  const trigger = screen.getAllByRole("combobox")[0];
  if (!trigger) throw new Error("селект модели не отрисовался");
  fireEvent.keyDown(trigger, { key: "Enter" });
  return within(screen.getByRole("listbox"));
}

describe("Composer PromptTextarea", () => {
  it("Enter без Shift отправляет", () => {
    const { onSend, field } = renderComposer();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("Shift+Enter не отправляет", () => {
    const { onSend, field } = renderComposer();
    fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("Enter в поле не всплывает до глобального send", () => {
    const { onSend, field } = renderComposer();
    const onDocumentSend = vi.fn();
    document.addEventListener("keydown", onDocumentSend);
    try {
      fireEvent.keyDown(field, { key: "Enter", metaKey: true, bubbles: true });
      expect(onSend).toHaveBeenCalledTimes(1);
      expect(onDocumentSend).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", onDocumentSend);
    }
  });
});

describe("Composer ModelSelect", () => {
  it("с одним провайдером заголовков групп нет", () => {
    renderComposer();
    const list = openModelSelect();
    expect(list.getByText("Haiku 4.5")).toBeTruthy();
    expect(list.queryByText("Claude")).toBeNull();
    expect(list.queryByText("OpenAI")).toBeNull();
  });

  it("с моделями двух вендоров селект разделён заголовками", () => {
    renderComposer({ models: [...CLAUDE_ONLY, GPT] });
    const list = openModelSelect();
    expect(list.getByText("Claude")).toBeTruthy();
    expect(list.getByText("OpenAI")).toBeTruthy();
    expect(list.getByText("GPT-5.6 Terra")).toBeTruthy();
  });

  it("выбор модели OpenAI уходит в патч чата", () => {
    const { onPatch } = renderComposer({ models: [...CLAUDE_ONLY, GPT] });
    const list = openModelSelect();
    fireEvent.click(list.getByText("GPT-5.6 Terra"));
    expect(onPatch).toHaveBeenCalledWith("c1", { model: "gpt-5.6-terra" });
  });
});
