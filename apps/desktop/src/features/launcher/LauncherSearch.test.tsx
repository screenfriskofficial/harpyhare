import i18next from "i18next";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { API_KEY_IDS } from "@/lib/api-keys";
import { LauncherSearch } from "./LauncherSearch";
import type { SearchHit, SearchSources } from "./search";

const PLACEHOLDER = "Поиск по настройкам";

const SOURCES: SearchSources = {
  presets: [{ id: "preset-1", name: "Мой пресет" }],
  quickActions: [],
  contextDocs: [],
  apiKeys: API_KEY_IDS,
};

function field(): HTMLInputElement {
  return screen.getByPlaceholderText<HTMLInputElement>(PLACEHOLDER);
}

function type(value: string) {
  fireEvent.change(field(), { target: { value } });
}

function navigateSpy() {
  return vi.fn<(hit: SearchHit) => void>();
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LauncherSearch", () => {
  it("ввод показывает результаты с путём до настройки", () => {
    render(<LauncherSearch sources={SOURCES} onNavigate={navigateSpy()} />);
    expect(screen.queryByRole("listbox")).toBeNull();
    type("Тема");
    const [option] = screen.getAllByRole("option");
    if (!option) throw new Error("нет результатов поиска");
    expect(option.textContent).toContain("Тема");
    expect(option.textContent).toContain("Настройки → Вид");
  });

  it("клик по результату зовёт onNavigate и очищает поиск", () => {
    const onNavigate = navigateSpy();
    render(<LauncherSearch sources={SOURCES} onNavigate={onNavigate} />);
    type("Мой пресет");
    fireEvent.click(screen.getByRole("option"));
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate.mock.calls[0]?.[0]?.screen).toBe("presets");
    expect(field().value).toBe("");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("стрелки двигают выделение, Enter открывает выделенный", () => {
    const onNavigate = navigateSpy();
    const presetsOnly: SearchSources = {
      presets: [
        { id: "p1", name: "Ремарка альфа" },
        { id: "p2", name: "Ремарка бета" },
        { id: "p3", name: "Ремарка гамма" },
      ],
      quickActions: [],
      contextDocs: [],
      apiKeys: API_KEY_IDS,
    };
    render(<LauncherSearch sources={presetsOnly} onNavigate={onNavigate} />);
    type("Ремарка");
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    fireEvent.keyDown(field(), { key: "ArrowUp" });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onNavigate.mock.calls[0]?.[0]?.title).toBe("Ремарка бета");
  });

  it("Escape закрывает список и очищает запрос", () => {
    render(<LauncherSearch sources={SOURCES} onNavigate={navigateSpy()} />);
    type("Тема");
    expect(screen.queryByRole("listbox")).not.toBeNull();
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(field().value).toBe("");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("потеря фокуса закрывает список, но запрос остаётся", () => {
    render(<LauncherSearch sources={SOURCES} onNavigate={navigateSpy()} />);
    type("Тема");
    fireEvent.blur(field());
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(field().value).toBe("Тема");
  });

  it("при отсутствии совпадений видно «Ничего не найдено»", () => {
    render(<LauncherSearch sources={SOURCES} onNavigate={navigateSpy()} />);
    type("ксилофон");
    expect(screen.getByText("Ничего не найдено")).not.toBeNull();
  });
});

it("refreshes open search results when the language changes", async () => {
  render(<LauncherSearch sources={SOURCES} onNavigate={navigateSpy()} />);
  type("API");
  expect(
    screen.getAllByRole("option").some((option) => option.textContent?.includes("Настройки")),
  ).toBe(true);
  await act(async () => {
    await i18next.changeLanguage("en");
  });
  expect(
    screen.getAllByRole("option").some((option) => option.textContent?.includes("Settings")),
  ).toBe(true);
  expect(screen.queryByPlaceholderText(PLACEHOLDER)).toBeNull();
});
