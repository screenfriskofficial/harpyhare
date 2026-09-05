import { useEffect } from "react";
import { useLatestRef } from "@/hooks/useLatestRef";
import { matchesModifier, parseFamilyModifier } from "@/lib/hotkey-match";
import { quickActionDigit } from "@/lib/quick-actions";

const DIGIT_CODE_PREFIX = "Digit";

function indexForDigit(digit: string, count: number): number | null {
  for (let index = 0; index < count; index += 1) {
    if (quickActionDigit(index) === digit) return index;
  }
  return null;
}

export function useQuickActionKeys(
  combo: string,
  count: number,
  onRun: (index: number) => void,
): void {
  const onRunRef = useLatestRef(onRun);

  useEffect(() => {
    const expected = parseFamilyModifier(combo);
    if (expected === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (!e.code.startsWith(DIGIT_CODE_PREFIX)) return;
      if (!matchesModifier(e, expected)) return;
      const index = indexForDigit(e.code.slice(DIGIT_CODE_PREFIX.length), count);
      if (index === null) return;
      e.preventDefault();
      onRunRef.current(index);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [combo, count, onRunRef]);
}
