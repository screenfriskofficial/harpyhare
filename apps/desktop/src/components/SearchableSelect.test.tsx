import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchableSelect } from "./SearchableSelect";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
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

function setup() {
  const onValueChange = vi.fn();
  render(
    <SearchableSelect
      value="openai/mini"
      ariaLabel="STT model"
      placeholder="Search models"
      emptyLabel="No matches"
      onValueChange={onValueChange}
      options={[
        { value: "openai/mini", label: "Mini", group: "OpenAI" },
        { value: "mistralai/voxtral", label: "Voxtral", group: "Mistral" },
        { value: "locked/model", label: "Locked", disabled: true },
      ]}
    />,
  );
  return { onValueChange, trigger: screen.getByRole("combobox", { name: "STT model" }) };
}

describe("SearchableSelect", () => {
  it("opens with the keyboard, focuses search and selects by model ID with Enter", async () => {
    const { trigger, onValueChange } = setup();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const input = screen.getByPlaceholderText("Search models");
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
    expect(document.getElementById(trigger.getAttribute("aria-controls") ?? "")).toBeTruthy();
    expect(document.getElementById(input.getAttribute("aria-controls") ?? "")).toBeTruthy();
    fireEvent.change(input, { target: { value: "mistralai/voxtral" } });
    await waitFor(() => {
      expect(screen.getAllByRole("option")).toHaveLength(1);
    });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onValueChange).toHaveBeenCalledWith("mistralai/voxtral");
    await waitFor(() => {
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
    });
  });

  it("shows no matches, clears search on reopen and never selects a disabled option", async () => {
    const { trigger, onValueChange } = setup();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByText("Locked"));
    expect(onValueChange).not.toHaveBeenCalled();
    const input = screen.getByPlaceholderText("Search models");
    fireEvent.change(input, { target: { value: "absent" } });
    await waitFor(() => {
      expect(screen.getByText("No matches")).toBeTruthy();
    });
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => {
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
    });
    fireEvent.click(trigger);
    expect(screen.getByPlaceholderText<HTMLInputElement>("Search models").value).toBe("");
    expect(screen.getByText("Voxtral")).toBeTruthy();
  });
});
