import { useEffect, type RefObject } from "react";

/** Blocks that scroll sideways inside the ledger: tables and code. */
export const SIDEWAYS_SCROLL_SELECTOR = ".table-scroll, pre";

/**
 * WebKit latches a wheel gesture onto the scrollable block under the pointer
 * as soon as that block has scrolled in any direction: after a sideways swipe
 * over a wide table, vertical wheel events keep going to the table's wrapper,
 * which has nothing to scroll that way, and the chat stops moving. So the
 * ledger takes vertical-dominant wheel events over such blocks itself and
 * scrolls by their delta; sideways-dominant ones stay with the block. The
 * listener is non-passive on purpose — a passive one could not cancel the
 * latched default.
 */
export function useWheelPassThrough(scrollRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const ledger = scrollRef.current;
    if (!ledger) return;
    const onWheel = (event: WheelEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest(SIDEWAYS_SCROLL_SELECTOR) === null) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      ledger.scrollTop += event.deltaY;
    };
    ledger.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      ledger.removeEventListener("wheel", onWheel);
    };
  }, [scrollRef]);
}
