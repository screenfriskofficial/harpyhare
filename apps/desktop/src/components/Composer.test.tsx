import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import { tick } from "@/test-utils/async";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Composer, type ComposerProps } from "./Composer";
import { createChat } from "@/lib/chats";
import { UiProviders } from "@/test/ui-wrapper";
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
};

afterEach(cleanup);

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
    onOverflowChange: vi.fn(),
    retryLabel: "Повторить",
    streaming: false,
    showRetry: false,
    presets: [],
    pipelines: [],
    pipelinesReady: true,
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

describe("Composer — пилюля и карточка", () => {
  const PARAMS = "Параметры запроса";
  const expanded = () => document.querySelector("[data-expanded]")?.getAttribute("data-expanded");
  const toolbarHidden = () =>
    document.querySelector("[data-slot='composer-toolbar']")?.getAttribute("aria-hidden");
  const leaveFocus = (field: HTMLElement, to: Element | null) => {
    fireEvent.focusOut(field, { relatedTarget: to });
  };

  it("с пустым черновиком и без фокуса — пилюля: тулбар скрыт и инертен, отправка выключена", () => {
    renderComposer({ chat: createChat(1, "c1") });
    expect(expanded()).toBe("false");
    expect(toolbarHidden()).toBe("true");
    expect(document.querySelector("[data-slot='composer-toolbar']")?.hasAttribute("inert")).toBe(
      true,
    );
    expect(screen.getByLabelText("Отправить").hasAttribute("disabled")).toBe(true);
  });

  it("фокус в поле раскрывает карточку, уход фокуса из пустой сворачивает её", () => {
    const { field } = renderComposer({ chat: createChat(1, "c1") });
    fireEvent.focusIn(field);
    expect(expanded()).toBe("true");
    expect(toolbarHidden()).toBe("false");
    leaveFocus(field, null);
    expect(expanded()).toBe("false");
  });

  it("клик по телу карточки раскрывает её и возвращает каретку в поле", () => {
    const onRestoreFocus = vi.fn();
    renderComposer({ chat: createChat(1, "c1"), onRestoreFocus });
    const card = document.querySelector<HTMLElement>("[data-expanded]");
    if (!card) throw new Error("card missing");
    fireEvent.mouseDown(card);
    expect(expanded()).toBe("true");
    expect(onRestoreFocus).toHaveBeenCalledTimes(1);
  });

  it("фокус, ушедший в поповер параметров или в тулбар, карточку не сворачивает", () => {
    const { field } = renderComposer({ chat: createChat(1, "c1") });
    fireEvent.focusIn(field);
    leaveFocus(field, screen.getByLabelText(PARAMS));
    expect(expanded()).toBe("true");
    const layer = document.createElement("div");
    layer.setAttribute("data-slot", "popover-content");
    document.body.append(layer);
    leaveFocus(field, layer);
    expect(expanded()).toBe("true");
    layer.remove();
  });

  it("черновик держит карточку раскрытой и без фокуса, отправка доступна", () => {
    const { field } = renderComposer();
    expect(expanded()).toBe("true");
    leaveFocus(field, null);
    expect(expanded()).toBe("true");
    expect(screen.getByLabelText("Отправить").hasAttribute("disabled")).toBe(false);
  });

  it("отправка сворачивает карточку, хотя поле остаётся в фокусе; клик раскрывает снова", () => {
    const { field, onSend } = renderComposer({ chat: createChat(1, "c1") });
    fireEvent.focusIn(field);
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(expanded()).toBe("false");
    fireEvent.mouseDown(field);
    expect(expanded()).toBe("true");
  });

  it("клик по кнопке тулбара гасит mousedown: каретка остаётся в поле, карточка раскрыта", () => {
    const onRestoreFocus = vi.fn();
    const { field } = renderComposer({ chat: createChat(1, "c1"), onRestoreFocus });
    fireEvent.focusIn(field);
    // WebKit never focuses a button by mouse: an unprevented mousedown would
    // blur the field to the body and fold the card under the very toolbar.
    expect(fireEvent.mouseDown(screen.getByLabelText(PARAMS))).toBe(false);
    expect(expanded()).toBe("true");
    expect(onRestoreFocus).not.toHaveBeenCalled();
  });

  it("клик внутри поповера параметров — дело поповера: событие не гасится, каретка не возвращается", () => {
    const onRestoreFocus = vi.fn();
    const { field } = renderComposer({ chat: createChat(1, "c1"), onRestoreFocus });
    fireEvent.focusIn(field);
    fireEvent.click(screen.getByLabelText(PARAMS));
    const content = document.querySelector("[data-slot='popover-content']");
    if (!content) throw new Error("поповер не открылся");
    expect(fireEvent.mouseDown(content)).toBe(true);
    expect(onRestoreFocus).not.toHaveBeenCalled();
  });

  const openParams = async () => {
    fireEvent.click(screen.getByLabelText(PARAMS));
    expect(document.querySelector("[data-slot='popover-content']")).not.toBeNull();
    await tick();
  };
  const paramsClosed = () => document.querySelector("[data-slot='popover-content']") === null;

  it("поповер параметров, закрытый с клавиатуры, возвращает каретку в поле", async () => {
    const onRestoreFocus = vi.fn();
    const { field } = renderComposer({ chat: createChat(1, "c1"), onRestoreFocus });
    fireEvent.focusIn(field);
    await openParams();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(paramsClosed()).toBe(true);
    await tick();
    expect(onRestoreFocus).toHaveBeenCalledTimes(1);
  });

  it("поповер, закрытый нажатием на кнопку тулбара, тоже возвращает каретку в поле", async () => {
    const onRestoreFocus = vi.fn();
    const { field } = renderComposer({ chat: createChat(1, "c1"), onRestoreFocus });
    fireEvent.focusIn(field);
    await openParams();
    const toolbar = document.querySelector<HTMLElement>("[data-slot='composer-toolbar']");
    const button = toolbar ? within(toolbar).getAllByRole("button")[0] : undefined;
    if (!button) throw new Error("кнопка тулбара не отрисовалась");
    // Radix dismisses a left-button press outside on the click that completes it.
    fireEvent.pointerDown(button);
    fireEvent.click(button);
    expect(paramsClosed()).toBe(true);
    await tick();
    expect(onRestoreFocus).toHaveBeenCalledTimes(1);
  });

  it("селект внутри поповера: blur из портала (WebKit шлёт его без relatedTarget) карточку не сворачивает", () => {
    const { field } = renderComposer({ chat: createChat(1, "c1") });
    fireEvent.focusIn(field);
    const list = openModelSelect();
    expect(list.getByText("Haiku 4.5")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    const content = document.querySelector("[data-slot='popover-content']");
    if (!content) throw new Error("поповер закрылся вместе с селектом");
    fireEvent.focusOut(content, { relatedTarget: null });
    expect(expanded()).toBe("true");
  });

  it("поповер, закрытый нажатием мимо карточки, каретку не трогает, а пустую карточку сворачивает", async () => {
    const onRestoreFocus = vi.fn();
    const { field } = renderComposer({ chat: createChat(1, "c1"), onRestoreFocus });
    fireEvent.focusIn(field);
    await openParams();
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);
    expect(paramsClosed()).toBe(true);
    await tick();
    expect(onRestoreFocus).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(expanded()).toBe("false");
    });
  });

  it("«Стоп» и «Повторить» есть и в пилюле, и клик по ним карточку не раскрывает", () => {
    const onStop = vi.fn();
    renderComposer({
      chat: createChat(1, "c1"),
      streaming: true,
      showRetry: true,
      onStop,
    });
    expect(screen.getByLabelText("Повторить")).toBeTruthy();
    const stop = screen.getByLabelText("Остановить ответ");
    fireEvent.mouseDown(stop);
    fireEvent.click(stop);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(expanded()).toBe("false");
    expect(screen.queryByLabelText("Отправить")).toBeNull();
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
