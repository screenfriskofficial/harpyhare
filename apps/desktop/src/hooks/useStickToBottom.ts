import { useCallback, useRef, useState, type RefObject } from "react";

const NEAR_BOTTOM_PX = 40;

export interface ScrollPosition {
  top: number;
  /** The bottom was in view — show it again after returning, even if the answer has grown. */
  atBottom: boolean;
}

export interface StickToBottom {
  scrollRef: RefObject<HTMLDivElement | null>;
  /** The «↓ Вниз» button is needed when there is somewhere to scroll and the bottom is out of view. */
  showJump: boolean;
  onScroll: () => void;
  resetToBottom: () => void;
  syncJump: () => void;
  /** Where the ledger currently stands; `null` while there is no element. */
  snapshot: () => ScrollPosition | null;
  restoreTop: (top: number) => void;
  /** The bottom was in view at the last measurement — show it again after the ledger changed underneath. */
  keepBottom: () => void;
}

function nearBottom(el: HTMLDivElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
}

/**
 * Автоскролла во время стрима нет намеренно: вниз прокручивают только
 * переключение чата, отправка своего сообщения и кнопка «↓ Вниз»; рост
 * ответа лишь обновляет видимость кнопки.
 */
export function useStickToBottom(): StickToBottom {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showJump, setShowJump] = useState(false);
  // Whether the bottom was in view at the last measurement: a change of the
  // ledger's own padding cannot be judged after the fact, the padding is
  // already part of the scroll height by then.
  const atBottomRef = useRef(false);

  const measure = useCallback((el: HTMLDivElement): boolean => {
    const near = nearBottom(el);
    atBottomRef.current = near;
    return near;
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    atBottomRef.current = true;
  }, []);

  const syncJump = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setShowJump(!measure(el) && el.scrollHeight > el.clientHeight);
  }, [measure]);

  const resetToBottom = useCallback(() => {
    scrollToBottom();
    setShowJump(false);
  }, [scrollToBottom]);

  const snapshot = useCallback((): ScrollPosition | null => {
    const el = scrollRef.current;
    return el ? { top: el.scrollTop, atBottom: measure(el) } : null;
  }, [measure]);

  const keepBottom = useCallback(() => {
    if (atBottomRef.current) scrollToBottom();
  }, [scrollToBottom]);

  const restoreTop = useCallback(
    (top: number) => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTop = top;
      syncJump();
    },
    [syncJump],
  );

  return {
    scrollRef,
    showJump,
    onScroll: syncJump,
    resetToBottom,
    syncJump,
    snapshot,
    restoreTop,
    keepBottom,
  };
}
