import i18next from "i18next";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UiProviders } from "@/test/ui-wrapper";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_MODES, DEFAULT_MODE, modeLabel, NOTES_MODE } from "@/lib/modes";
import { ModeSwitch } from "./ModeSwitch";

afterEach(() => {
  cleanup();
});

function renderSwitch(mode = DEFAULT_MODE) {
  const onSelect = vi.fn();
  render(<ModeSwitch mode={mode} combo="⌘⇧L" onSelect={onSelect} />, { wrapper: UiProviders });
  return onSelect;
}

describe("ModeSwitch", () => {
  it("рисует кнопку на каждый режим реестра", () => {
    renderSwitch();
    for (const mode of APP_MODES) {
      expect(screen.getByLabelText(`Режим: ${modeLabel(mode.id)}`)).toBeTruthy();
    }
  });

  it("отмечает текущий режим нажатым", () => {
    renderSwitch();
    expect(screen.getByLabelText("Режим: Чат").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("Режим: Заметки").getAttribute("aria-pressed")).toBe("false");
  });

  it("клик по режиму сообщает его наверх", () => {
    const onSelect = renderSwitch();
    fireEvent.click(screen.getByLabelText("Режим: Заметки"));
    expect(onSelect).toHaveBeenCalledWith(NOTES_MODE);
  });
});

it("updates an already mounted HUD control when the language changes", async () => {
  renderSwitch();
  expect(screen.getByLabelText("Режим: Чат")).toBeTruthy();
  await act(async () => {
    await i18next.changeLanguage("en");
  });
  expect(screen.getByLabelText("Mode: Chat")).toBeTruthy();
  expect(screen.queryByLabelText("Режим: Чат")).toBeNull();
});
