import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnswerPanel } from "./AnswerPanel";
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

describe("AnswerPanel — подсветка кода", () => {
  it("код с языком получает hljs-токены", () => {
    const assistant: ChatMessage = {
      role: "assistant",
      text: 'Вот:\n\n```js\nconst a = "строка"; // комментарий\n```\n',
      images: [],
    };
    const { container } = render(
      <AnswerPanel
        chatId="c1"
        streamStartedAt={undefined}
        scrollStep={120}
        messages={[assistant]}
        partial={null}
        streaming={false}
        scrollModifier="Alt"
        recordCombo=""
        screenshotCombo=""
        onTogglePreview={() => undefined}
        onCopyMessage={() => undefined}
        onRemoveMessage={() => undefined}
        onResendMessage={() => undefined}
      />,
    );
    expect(container.querySelector("code.hljs")).toBeTruthy();
    expect(container.querySelector(".hljs-keyword")?.textContent).toBe("const");
    expect(container.querySelector(".hljs-string")).toBeTruthy();
    expect(container.querySelector(".hljs-comment")).toBeTruthy();
  });

  it("код без языка автоопределяется", () => {
    const assistant: ChatMessage = {
      role: "assistant",
      text: "```\ndef main():\n    return 42\n```\n",
      images: [],
    };
    const { container } = render(
      <AnswerPanel
        chatId="c1"
        streamStartedAt={undefined}
        scrollStep={120}
        messages={[assistant]}
        partial={null}
        streaming={false}
        scrollModifier="Alt"
        recordCombo=""
        screenshotCombo=""
        onTogglePreview={() => undefined}
        onCopyMessage={() => undefined}
        onRemoveMessage={() => undefined}
        onResendMessage={() => undefined}
      />,
    );
    expect(container.querySelector(".hljs-keyword")).toBeTruthy();
  });

  it("```html остаётся чипом превью, а не подсвеченным кодом", () => {
    const assistant: ChatMessage = {
      role: "assistant",
      text: "```html\n<h1>привет</h1>\n```\n",
      images: [],
    };
    const { container, getByText } = render(
      <AnswerPanel
        chatId="c1"
        streamStartedAt={undefined}
        scrollStep={120}
        messages={[assistant]}
        partial={null}
        streaming={false}
        scrollModifier="Alt"
        recordCombo=""
        screenshotCombo=""
        onTogglePreview={() => undefined}
        onCopyMessage={() => undefined}
        onRemoveMessage={() => undefined}
        onResendMessage={() => undefined}
      />,
    );
    expect(getByText(/Открыть превью/)).toBeTruthy();
    expect(container.querySelector("code.hljs")).toBeNull();
  });
});

describe("AnswerPanel — индикатор ожидания", () => {
  it("показывает «Думает…», пока стрим без текста", () => {
    const { getByText } = render(
      <AnswerPanel
        chatId="c1"
        streamStartedAt={undefined}
        scrollStep={120}
        messages={[userMsg]}
        partial=""
        streaming={true}
        scrollModifier="Alt"
        recordCombo=""
        screenshotCombo=""
        onTogglePreview={() => undefined}
        onCopyMessage={() => undefined}
        onRemoveMessage={() => undefined}
        onResendMessage={() => undefined}
      />,
    );
    expect(getByText(/Думает…/)).toBeTruthy();
  });

  it("не показывает индикатор, когда пошёл текст ответа", () => {
    const { queryByText } = render(
      <AnswerPanel
        chatId="c1"
        streamStartedAt={undefined}
        scrollStep={120}
        messages={[userMsg]}
        partial="Привет"
        streaming={true}
        scrollModifier="Alt"
        recordCombo=""
        screenshotCombo=""
        onTogglePreview={() => undefined}
        onCopyMessage={() => undefined}
        onRemoveMessage={() => undefined}
        onResendMessage={() => undefined}
      />,
    );
    expect(queryByText(/Думает…/)).toBeNull();
  });

  it("не показывает индикатор без стрима", () => {
    const { queryByText } = render(
      <AnswerPanel
        chatId="c1"
        streamStartedAt={undefined}
        scrollStep={120}
        messages={[userMsg]}
        partial={null}
        streaming={false}
        scrollModifier="Alt"
        recordCombo=""
        screenshotCombo=""
        onTogglePreview={() => undefined}
        onCopyMessage={() => undefined}
        onRemoveMessage={() => undefined}
        onResendMessage={() => undefined}
      />,
    );
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
    return render(
      <AnswerPanel
        chatId="c1"
        streamStartedAt={undefined}
        scrollStep={120}
        messages={messages}
        partial={null}
        streaming={false}
        scrollModifier="Alt"
        recordCombo=""
        screenshotCombo=""
        onTogglePreview={() => undefined}
        onCopyMessage={() => undefined}
        onRemoveMessage={() => undefined}
        onResendMessage={() => undefined}
      />,
    );
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
