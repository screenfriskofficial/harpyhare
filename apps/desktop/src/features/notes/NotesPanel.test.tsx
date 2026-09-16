import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContextLibrary } from "@/lib/context-library";
import { buildNotesIndex } from "@/lib/notes-search";
import { NotesPanel } from "./NotesPanel";

vi.mock("@/ipc/events", () => ({ onFileDrop: vi.fn(() => () => undefined) }));
vi.mock("@/ipc/commands", () => ({
  readContextImportFile: vi.fn(),
  readContextPdfBytes: vi.fn(),
  openExternal: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

const LIBRARY: ContextLibrary = {
  folders: [{ id: "work", name: "Работа" }],
  docs: [
    {
      id: "react",
      name: "React 19",
      text: "# Хуки\n\nконкурентный рендер и Server Components.",
      folderId: "",
    },
    {
      id: "rust",
      name: "Rust и Tauri",
      text: "Владение и заимствование.",
      folderId: "work",
    },
  ],
};

const SEARCH_LABEL = "Поиск по заметкам";

function renderPanel(overrides: Partial<Parameters<typeof NotesPanel>[0]> = {}) {
  const props = {
    library: LIBRARY,
    index: buildNotesIndex(LIBRARY.docs),
    addDoc: vi.fn(),
    onLeave: vi.fn(),
    ...overrides,
  };
  render(<NotesPanel {...props} />);
  return props;
}

function field() {
  return screen.getByLabelText(SEARCH_LABEL);
}

function typeQuery(text: string) {
  fireEvent.change(field(), { target: { value: text } });
}

function suggestions() {
  return within(screen.getByRole("listbox"));
}

describe("NotesPanel", () => {
  it("без запроса показывает всю библиотеку, разложенную по папкам", () => {
    renderPanel();
    expect(screen.getByText("React 19")).toBeTruthy();
    expect(screen.getByText("Rust и Tauri")).toBeTruthy();
    expect(screen.getByText("Работа")).toBeTruthy();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("ввод запроса даёт подсказки и НЕ перестраивает экран под ними", () => {
    renderPanel();
    typeQuery("заимствование");
    expect(suggestions().getAllByRole("option")).toHaveLength(1);
    expect(suggestions().getByText("Rust и Tauri")).toBeTruthy();
    expect(screen.getByText("React 19")).toBeTruthy();
  });

  it("подсказка показывает цитату с подсветкой совпадения", () => {
    renderPanel();
    typeQuery("заимствование");
    expect(suggestions().getByText("заимствование").tagName).toBe("MARK");
  });

  it("открытая заметка остаётся на экране, пока ищешь дальше", () => {
    renderPanel();
    typeQuery("владение");
    fireEvent.keyDown(field(), { key: "Enter" });
    typeQuery("конкурентный");
    expect(screen.getByText("Владение и заимствование.")).toBeTruthy();
    expect(suggestions().getByText("React 19")).toBeTruthy();
  });

  it("стрелки двигают выбор, Enter открывает и закрывает подсказки", () => {
    renderPanel();
    typeQuery("рендер");
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByText("Хуки")).toBeTruthy();
  });

  it("клик по подсказке открывает заметку", () => {
    renderPanel();
    typeQuery("заимствование");
    fireEvent.click(suggestions().getByRole("option"));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByText("Владение и заимствование.")).toBeTruthy();
  });

  it("стрелка вниз возвращает закрытые подсказки", () => {
    renderPanel();
    typeQuery("заимствование");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("клик мимо закрывает подсказки", () => {
    renderPanel();
    typeQuery("заимствование");
    fireEvent.mouseDown(screen.getByText("React 19"));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("на пустой выдаче подсказки объясняют, что делать", () => {
    renderPanel();
    typeQuery("кванты");
    expect(suggestions().getByText("Ничего не найдено")).toBeTruthy();
  });

  it("Escape идёт шагами: подсказки, заметка, запрос, режим", () => {
    const { onLeave } = renderPanel();
    typeQuery("владение");
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(screen.getByText("Владение и заимствование.")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("Владение и заимствование.")).toBeNull();
    expect(onLeave).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByLabelText<HTMLInputElement>(SEARCH_LABEL).value).toBe("");
    expect(onLeave).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onLeave).toHaveBeenCalled();
  });

  it("пустая библиотека зовёт добавить файлы", () => {
    renderPanel({ library: { folders: [], docs: [] }, index: buildNotesIndex([]) });
    expect(screen.getByText("Заметок пока нет")).toBeTruthy();
  });
});
