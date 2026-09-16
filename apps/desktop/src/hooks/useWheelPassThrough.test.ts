import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useWheelPassThrough } from "./useWheelPassThrough";

function ledgerWithTable() {
  const ledger = document.createElement("div");
  let top = 0;
  Object.defineProperty(ledger, "scrollTop", {
    get: () => top,
    set: (value: number) => {
      top = value;
    },
  });
  const wrapper = document.createElement("div");
  wrapper.className = "table-scroll";
  const cell = document.createElement("td");
  wrapper.append(cell);
  const paragraph = document.createElement("p");
  ledger.append(wrapper, paragraph);
  document.body.append(ledger);
  return { ledger, cell, paragraph, ref: { current: ledger } };
}

function wheel(target: Element, deltaX: number, deltaY: number): boolean {
  return target.dispatchEvent(
    new WheelEvent("wheel", { deltaX, deltaY, bubbles: true, cancelable: true }),
  );
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useWheelPassThrough", () => {
  it("вертикальное колесо над таблицей крутит ленту и гасит захват обёртки", () => {
    const { ledger, cell, ref } = ledgerWithTable();
    renderHook(() => {
      useWheelPassThrough(ref);
    });
    const allowed = wheel(cell, 2, 40);
    expect(allowed).toBe(false);
    expect(ledger.scrollTop).toBe(40);
    wheel(cell, 0, -15);
    expect(ledger.scrollTop).toBe(25);
  });

  it("боковой жест остаётся у таблицы", () => {
    const { ledger, cell, ref } = ledgerWithTable();
    renderHook(() => {
      useWheelPassThrough(ref);
    });
    expect(wheel(cell, 30, 5)).toBe(true);
    expect(ledger.scrollTop).toBe(0);
  });

  it("колесо над обычным текстом ленту не трогает — это её родная прокрутка", () => {
    const { ledger, paragraph, ref } = ledgerWithTable();
    renderHook(() => {
      useWheelPassThrough(ref);
    });
    expect(wheel(paragraph, 0, 40)).toBe(true);
    expect(ledger.scrollTop).toBe(0);
  });

  it("после размонтирования слушателя нет", () => {
    const { ledger, cell, ref } = ledgerWithTable();
    const { unmount } = renderHook(() => {
      useWheelPassThrough(ref);
    });
    unmount();
    expect(wheel(cell, 0, 40)).toBe(true);
    expect(ledger.scrollTop).toBe(0);
  });
});
