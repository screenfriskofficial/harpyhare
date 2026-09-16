import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "@/ipc/types";
import type { SetSetting } from "../contract";
import { HotkeysSection } from "./HotkeysSection";

const TOGGLE_HINT = "Нажмите, чтобы начать запись, и ещё раз, чтобы закончить.";
const HOLD_HINT = "Удерживайте, пока говорит собеседник.";

afterEach(cleanup);

function renderSection(overrides: Partial<Settings> = {}) {
  const set = vi.fn<SetSetting>();
  render(<HotkeysSection draft={{ ...DEFAULT_SETTINGS, ...overrides }} set={set} />);
  return set;
}

describe("HotkeysSection — режим клавиши записи", () => {
  it("по умолчанию запись по нажатию: тумблер включён, подсказка клавиши про два нажатия", () => {
    renderSection();
    expect(
      screen.getByRole("switch", { name: "Запись по нажатию" }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.getByText(TOGGLE_HINT)).toBeTruthy();
    expect(screen.queryByText(HOLD_HINT)).toBeNull();
  });

  it("с выключенным тумблером подсказка клавиши говорит про удержание", () => {
    renderSection({ record_toggle: false });
    expect(screen.getByText(HOLD_HINT)).toBeTruthy();
    expect(screen.queryByText(TOGGLE_HINT)).toBeNull();
  });

  it("тумблер пишет record_toggle в черновик", () => {
    const set = renderSection();
    fireEvent.click(screen.getByRole("switch", { name: "Запись по нажатию" }));
    expect(set).toHaveBeenCalledWith("record_toggle", false);
  });
});
