import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";

/**
 * Авторост поля промпта: `field-sizing: content` в WKWebView не работает,
 * поэтому высота подгоняется по `scrollHeight`. Ширина отслеживается через
 * `ResizeObserver` на РОДИТЕЛЕ, а не на самом поле: `fit` меняет высоту
 * наблюдаемого элемента, и наблюдение за ним самим давало бы
 * «ResizeObserver loop completed with undelivered notifications» на каждый
 * ресайз окна с переносом строк.
 */
export function usePromptAutosize(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  maxHeightPx: number,
): void {
  const lastWidth = useRef<number | null>(null);

  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${String(Math.min(el.scrollHeight, maxHeightPx))}px`;
  }, [ref, maxHeightPx]);

  useLayoutEffect(fit, [fit, value]);

  useEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? null;
      if (width === lastWidth.current) return;
      lastWidth.current = width;
      fit();
    });
    observer.observe(parent);
    return () => {
      observer.disconnect();
    };
  }, [ref, fit]);
}
