import { useEffect, type RefObject } from "react";
import { matchesModifier, parseFamilyModifier } from "@/lib/hotkey-match";

const ARROW_DOWN_CODE = "ArrowDown";
const ARROW_UP_CODE = "ArrowUp";

/** «Модификатор + стрелки» прокручивает ленту, не трогая каретку в поле промпта. */
export function useHotkeyScroll(
  scrollRef: RefObject<HTMLDivElement | null>,
  stepPx: number,
  modifier: string,
): void {
  useEffect(() => {
    const expected = parseFamilyModifier(modifier);
    if (expected === null) return;
    const onKey = (e: KeyboardEvent) => {
      const dir = e.code === ARROW_DOWN_CODE ? 1 : e.code === ARROW_UP_CODE ? -1 : 0;
      if (dir === 0) return;
      if (!matchesModifier(e, expected)) return;
      e.preventDefault();
      scrollRef.current?.scrollBy({ top: dir * stepPx, behavior: "smooth" });
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [scrollRef, stepPx, modifier]);
}
