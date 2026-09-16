import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useComposerZone, type ComposerZoneRefs } from "./useComposerZone";

// A ResizeObserver the test fires by hand: jsdom has no layout, so the observed
// elements report whatever heights the test assigns to them.
let fire: (() => void) | undefined;
const originalObserver = globalThis.ResizeObserver;
class ManualResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    fire = () => {
      callback([], this);
    };
  }
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

interface Heights {
  card: number;
  row: number;
  content: number;
  bar: number;
}

function elementsWith(heights: Heights): { refs: ComposerZoneRefs; heights: Heights } {
  const make = (key: keyof Heights) => {
    const el = document.createElement("div");
    Object.defineProperty(el, "offsetHeight", { get: () => heights[key], configurable: true });
    return { current: el };
  };
  return {
    refs: { card: make("card"), row: make("row"), content: make("content"), bar: make("bar") },
    heights,
  };
}

const BAR_GAP = 6;

beforeEach(() => {
  globalThis.ResizeObserver = ManualResizeObserver;
});
afterEach(() => {
  globalThis.ResizeObserver = originalObserver;
  fire = undefined;
});

describe("useComposerZone", () => {
  it("свёрнутая карточка: слот равен строке поля, выноса нет, полоса без действий не считается", () => {
    const { refs } = elementsWith({ card: 40, row: 40, content: 120, bar: 0 });
    const onOverflow = vi.fn();
    const { result } = renderHook(() => useComposerZone(refs, false, BAR_GAP, onOverflow));
    expect(result.current).toEqual({ slot: 40, cardHeight: 40 });
    expect(onOverflow).toHaveBeenLastCalledWith(0);
  });

  it("раскрытая карточка растёт до содержимого, а вынос над лентой — на сколько она выше строки", () => {
    const { refs, heights } = elementsWith({ card: 40, row: 40, content: 120, bar: 24 });
    const onOverflow = vi.fn();
    const { result, rerender } = renderHook(
      ({ expanded }) => useComposerZone(refs, expanded, BAR_GAP, onOverflow),
      { initialProps: { expanded: false } },
    );
    expect(result.current.slot).toBe(24 + BAR_GAP + 40);
    heights.card = 120;
    rerender({ expanded: true });
    act(() => {
      fire?.();
    });
    expect(result.current).toEqual({ slot: 24 + BAR_GAP + 40, cardHeight: 120 });
    expect(onOverflow).toHaveBeenLastCalledWith(80);
  });

  it("повторный замер с теми же числами не порождает ни нового состояния, ни нового вызова", () => {
    const { refs } = elementsWith({ card: 40, row: 40, content: 120, bar: 0 });
    const onOverflow = vi.fn();
    const { result } = renderHook(() => useComposerZone(refs, false, BAR_GAP, onOverflow));
    const before = result.current;
    const calls = onOverflow.mock.calls.length;
    act(() => {
      fire?.();
    });
    expect(result.current).toBe(before);
    expect(onOverflow).toHaveBeenCalledTimes(calls);
  });

  it("без элементов ничего не меряет: композер остаётся в потоке", () => {
    const refs: ComposerZoneRefs = {
      card: { current: null },
      row: { current: null },
      content: { current: null },
      bar: { current: null },
    };
    const { result } = renderHook(() => useComposerZone(refs, true, BAR_GAP, vi.fn()));
    expect(result.current).toEqual({ slot: null, cardHeight: null });
  });
});
