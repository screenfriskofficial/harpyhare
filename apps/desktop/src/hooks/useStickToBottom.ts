import { useCallback, useRef, useState, type RefObject } from "react";

const NEAR_BOTTOM_PX = 40;

export interface StickToBottom {
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Кнопка «↓ Вниз» нужна, когда есть куда прокрутить и низ не виден. */
  showJump: boolean;
  onScroll: () => void;
  resetToBottom: () => void;
  syncJump: () => void;
}

/**
 * Автоскролла во время стрима нет намеренно: вниз прокручивают только
 * переключение чата, отправка своего сообщения и кнопка «↓ Вниз»; рост
 * ответа лишь обновляет видимость кнопки.
 */
export function useStickToBottom(): StickToBottom {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showJump, setShowJump] = useState(false);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const syncJump = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    setShowJump(!near && el.scrollHeight > el.clientHeight);
  }, []);

  const resetToBottom = useCallback(() => {
    scrollToBottom();
    setShowJump(false);
  }, [scrollToBottom]);

  return { scrollRef, showJump, onScroll: syncJump, resetToBottom, syncJump };
}
