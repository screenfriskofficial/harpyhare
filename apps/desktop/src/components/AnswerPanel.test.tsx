import { cleanup, fireEvent, render } from "@testing-library/react";
import type { RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnswerPanel, type AnswerPanelProps, type ChatScrollMemory } from "./AnswerPanel";
import type { ChatMessage } from "@/lib/chats";

vi.mock("@/ipc/commands", () => ({
  openExternal: vi.fn(),
}));

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const userMsg: ChatMessage = { role: "user", text: "напиши тетрис", images: [] };
const noop = () => undefined;

function assistant(text: string): ChatMessage {
  return { role: "assistant", text, images: [] };
}

/** Every prop the panel needs, with quiet defaults a test overrides one at a time. */
function panelProps(overrides: Partial<AnswerPanelProps> = {}): AnswerPanelProps {
  return {
    messages: [],
    chatId: "c1",
    scrollMemory: { current: null },
    bottomInset: 0,
    partial: null,
    streaming: false,
    streamStartedAt: undefined,
    scrollStep: 120,
    scrollModifier: "Alt",
    recordCombo: "",
    screenshotCombo: "",
    onTogglePreview: noop,
    onCopyMessage: noop,
    onRemoveMessage: noop,
    onResendMessage: noop,
    ...overrides,
  };
}

function renderAnswerPanel(overrides: Partial<AnswerPanelProps> = {}) {
  return render(<AnswerPanel {...panelProps(overrides)} />);
}

const JS_ANSWER = 'Вот:\n\n```js\nconst a = "строка"; // комментарий\n```\n';
const BARE_ANSWER = "```\ndef main():\n    return 42\n```\n";
const HTML_ANSWER = "```html\n<h1>привет</h1>\n```\n";

describe("AnswerPanel — подсветка кода", () => {
  it("код с языком получает hljs-токены", () => {
    const { container } = renderAnswerPanel({ messages: [assistant(JS_ANSWER)] });
    expect(container.querySelector("code.hljs")).toBeTruthy();
    expect(container.querySelector(".hljs-keyword")?.textContent).toBe("const");
    expect(container.querySelector(".hljs-string")).toBeTruthy();
    expect(container.querySelector(".hljs-comment")).toBeTruthy();
  });

  it("код без языка автоопределяется", () => {
    const { container } = renderAnswerPanel({ messages: [assistant(BARE_ANSWER)] });
    expect(container.querySelector(".hljs-keyword")).toBeTruthy();
  });

  it("```html остаётся чипом превью, а не подсвеченным кодом", () => {
    const { container, getByText } = renderAnswerPanel({ messages: [assistant(HTML_ANSWER)] });
    expect(getByText(/Открыть превью/)).toBeTruthy();
    expect(container.querySelector("code.hljs")).toBeNull();
  });
});

describe("AnswerPanel — индикатор ожидания", () => {
  it("показывает «Думает…», пока стрим без текста", () => {
    const { getByText } = renderAnswerPanel({ messages: [userMsg], partial: "", streaming: true });
    expect(getByText(/Думает…/)).toBeTruthy();
  });

  it("не показывает индикатор, когда пошёл текст ответа", () => {
    const { queryByText } = renderAnswerPanel({
      messages: [userMsg],
      partial: "Привет",
      streaming: true,
    });
    expect(queryByText(/Думает…/)).toBeNull();
  });

  it("не показывает индикатор без стрима", () => {
    const { queryByText } = renderAnswerPanel({ messages: [userMsg] });
    expect(queryByText(/Думает…/)).toBeNull();
  });
});

describe("AnswerPanel — картинки в сообщении пользователя", () => {
  const withImage: ChatMessage = {
    role: "user",
    text: "что тут не так?",
    images: [{ media_type: "image/png", data: "iVBORw0K" }],
  };

  function renderMessages(messages: ChatMessage[]) {
    return renderAnswerPanel({ messages });
  }

  it("отправленная картинка видна в пузыре, а не только уходит в запрос", () => {
    const { container } = renderMessages([withImage]);
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("data:image/png;base64,iVBORw0K");
  });

  it("текст сообщения остаётся рядом с картинкой", () => {
    const { container } = renderMessages([withImage]);
    expect(container.textContent).toContain("что тут не так?");
  });

  it("сообщение без картинок не рисует пустых img", () => {
    const { container } = renderMessages([userMsg]);
    expect(container.querySelector("img")).toBeNull();
  });

  it("картинка без текста показывается сама по себе", () => {
    const { container } = renderMessages([{ ...withImage, text: "" }]);
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });
});

describe("AnswerPanel — память скролла", () => {
  let SCROLL_HEIGHT = 1000;
  const CLIENT_HEIGHT = 300;
  const tops = new WeakMap<Element, number>();
  const original = {
    scrollTop: Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop"),
    scrollHeight: Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight"),
    clientHeight: Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight"),
  };
  // jsdom has no layout: the ledger gets a fixed height and a scroll offset that sticks.
  beforeEach(() => {
    SCROLL_HEIGHT = 1000;
    Object.defineProperty(Element.prototype, "scrollTop", {
      configurable: true,
      get(this: Element) {
        return tops.get(this) ?? 0;
      },
      set(this: Element, value: number) {
        tops.set(this, value);
      },
    });
    Object.defineProperty(Element.prototype, "scrollHeight", {
      configurable: true,
      get: () => SCROLL_HEIGHT,
    });
    Object.defineProperty(Element.prototype, "clientHeight", {
      configurable: true,
      get: () => CLIENT_HEIGHT,
    });
  });
  afterEach(() => {
    for (const [name, descriptor] of Object.entries(original)) {
      if (descriptor) Object.defineProperty(Element.prototype, name, descriptor);
      else Reflect.deleteProperty(Element.prototype, name);
    }
  });

  const panel = (chatId: string, memory: RefObject<ChatScrollMemory | null>, inset: number) => (
    <AnswerPanel
      {...panelProps({ chatId, scrollMemory: memory, bottomInset: inset, messages: [userMsg] })}
    />
  );
  function renderPanel(chatId: string, memory: RefObject<ChatScrollMemory | null>, inset = 0) {
    const ui = render(panel(chatId, memory, inset));
    const ledger = ui.container.querySelector<HTMLElement>(".overflow-y-auto");
    if (!ledger) throw new Error("ledger missing");
    return { ...ui, ledger };
  }

  it("после размонтирования помнит, где стоял чат, и возвращает его на то же место", () => {
    const memory: RefObject<ChatScrollMemory | null> = { current: null };
    const first = renderPanel("c1", memory);
    expect(first.ledger.scrollTop).toBe(SCROLL_HEIGHT);
    first.ledger.scrollTop = 400;
    first.unmount();
    expect(memory.current).toEqual({ chatId: "c1", top: 400, atBottom: false });
    const second = renderPanel("c1", memory);
    expect(second.ledger.scrollTop).toBe(400);
    expect(memory.current).toBeNull();
  });

  it("если низ был виден, после возврата снова показывает низ — даже если ответ дорос", () => {
    const memory: RefObject<ChatScrollMemory | null> = { current: null };
    const first = renderPanel("c1", memory);
    first.ledger.scrollTop = SCROLL_HEIGHT - CLIENT_HEIGHT - 10;
    first.unmount();
    expect(memory.current?.atBottom).toBe(true);
    const second = renderPanel("c1", memory);
    expect(second.ledger.scrollTop).toBe(SCROLL_HEIGHT);
  });

  it("отступ под композер держит низ ленты на виду только у того, кто и так был внизу", () => {
    const memory: RefObject<ChatScrollMemory | null> = { current: null };
    const { ledger, rerender } = renderPanel("c1", memory);
    expect(ledger.scrollTop).toBe(SCROLL_HEIGHT);
    // The composer opened: the ledger's padding grew and so did its scroll height.
    SCROLL_HEIGHT = 1064;
    rerender(panel("c1", memory, 64));
    expect(ledger.style.paddingBottom).toBe("64px");
    // Nothing is painted under the composer: its card is translucent.
    expect(ledger.getAttribute("style")).toContain("clip-path: inset(0 0 64px 0)");
    expect(ledger.scrollTop).toBe(1064);
    // A reader higher up is not dragged along.
    ledger.scrollTop = 400;
    fireEvent.scroll(ledger);
    SCROLL_HEIGHT = 1000;
    rerender(panel("c1", memory, 0));
    expect(ledger.scrollTop).toBe(400);
    expect(ledger.getAttribute("style")).not.toContain("clip-path");
  });

  it("другой чат открывается внизу, а чужая память тратится", () => {
    const memory: RefObject<ChatScrollMemory | null> = {
      current: { chatId: "c1", top: 400, atBottom: false },
    };
    const { ledger } = renderPanel("c2", memory);
    expect(ledger.scrollTop).toBe(SCROLL_HEIGHT);
    expect(memory.current).toBeNull();
  });
});
