import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EffortPicker, type EffortPickerProps } from "./EffortPicker";
import { createChat } from "@/lib/chats";
import type { ModelInfo } from "@/lib/models";
import { PROVIDER_ANTHROPIC } from "@/test/providers";
import { UiProviders } from "@/test/ui-wrapper";

afterEach(cleanup);

const OPUS: ModelInfo = {
  id: "claude-opus-5-5",
  displayName: "Claude Opus 5.5",
  provider: PROVIDER_ANTHROPIC,
  adaptive: true,
  alwaysThinks: true,
  codeExec: true,
  efforts: ["low", "medium", "high", "xhigh", "max"],
  budgetThinking: false,
  defaultEffort: "medium",
};

const HAIKU_4_5: ModelInfo = {
  ...OPUS,
  id: "claude-haiku-4-5-20251001",
  displayName: "Claude Haiku 4.5",
  adaptive: false,
  alwaysThinks: false,
  efforts: [],
  budgetThinking: true,
  defaultEffort: null,
};

function renderPicker(overrides: Partial<EffortPickerProps> = {}) {
  const props: EffortPickerProps = {
    chat: { ...createChat(1, "c1"), model: OPUS.id },
    model: OPUS,
    onPatch: vi.fn(),
    onClosed: vi.fn(),
    ...overrides,
  };
  render(
    <UiProviders>
      <EffortPicker {...props} />
    </UiProviders>,
  );
  return props;
}

describe("EffortPicker", () => {
  it("подпись кнопки называет то, что уйдёт в запрос", () => {
    renderPicker({ chat: { ...createChat(1, "c1"), thinkingEnabled: true, effort: "high" } });
    expect(screen.getByRole("button", { name: "Усилие: Высокое" })).toBeTruthy();
  });

  it("как в claude.ai: только уровни модели, уровень по умолчанию помечен", () => {
    const props = renderPicker();
    fireEvent.click(screen.getByRole("button", { name: "Усилие: Среднее" }));
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
      "false",
      "false",
      "false",
    ]);
    expect(screen.queryByRole("radio", { name: /Без рассуждения/ })).toBeNull();
    expect(screen.getByRole("radio", { name: /Среднее/ }).textContent).toContain("по умолчанию");
    fireEvent.click(screen.getByRole("radio", { name: /Максимум/ }));
    expect(props.onPatch).toHaveBeenCalledWith("c1", { thinkingEnabled: true, effort: "max" });
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("модель с бюджетом рассуждения — переключатель «Расширенное рассуждение»", () => {
    const props = renderPicker({
      model: HAIKU_4_5,
      chat: { ...createChat(1, "c1"), model: HAIKU_4_5.id, thinkingEnabled: false },
    });
    fireEvent.click(screen.getByRole("button", { name: "Усилие: Без рассуждения" }));
    expect(screen.queryByRole("radiogroup")).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Расширенное рассуждение" }));
    expect(props.onPatch).toHaveBeenCalledWith("c1", { thinkingEnabled: true });
  });

  it("стрелки ходят по уровням от текущего выбора", () => {
    renderPicker({ chat: { ...createChat(1, "c1"), thinkingEnabled: true, effort: "medium" } });
    fireEvent.click(screen.getByRole("button", { name: "Усилие: Среднее" }));
    const current = screen.getByRole("radio", { name: /Среднее/ });
    expect(current.getAttribute("aria-checked")).toBe("true");
    current.focus();
    fireEvent.keyDown(current, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: /Высокое/ }));
  });

  it("модель без рассуждения: кнопка погашена, подсказка объясняет почему", () => {
    renderPicker({
      model: { ...OPUS, adaptive: false, alwaysThinks: false, efforts: [], defaultEffort: null },
    });
    const button = screen.getByRole("button", {
      name: "Эта модель не рассуждает — уровень усилия не применяется",
    });
    expect(button.hasAttribute("disabled")).toBe(true);
  });
});
