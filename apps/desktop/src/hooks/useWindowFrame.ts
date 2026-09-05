import { useEffect, useRef } from "react";
import { collapseMainWindow, expandMainWindow, setWindowSize } from "@/ipc/commands";
import { onWindowResized, type LogicalWindowSize } from "@/ipc/events";
import { PREVIEW_EXTRA_WIDTH_PX } from "@/lib/shell-layout";
import { nativeSizeEcho, windowSizesEqual } from "@/lib/window-size";
import { useLatestRef } from "./useLatestRef";

/**
 * После программного ресайза нативные события окна несколько сотен
 * миллисекунд ещё «эхом» отдают промежуточные размеры; всё это время они не
 * считаются пользовательским ресайзом.
 */
const PROGRAMMATIC_RESIZE_GUARD_MS = 600;

export interface WindowFrameInput {
  windowWidth: number;
  windowHeight: number;
  previewOpen: boolean;
  miniMode: boolean;
  /** Настройки уже загружены — до этого дефолтный размер применять нельзя. */
  ready: boolean;
  applyNativeWindowSize: (width: number, height: number) => void;
}

/**
 * Две половины одной петли: настройки → нативное окно (`useFrameFromSettings`)
 * и нативное окно → настройки (`useSettingsFromNativeResize`). Общие ref'ы —
 * последний нативный размер и guard от эха — деталь реализации, наружу не выходят.
 */
export function useWindowFrame(input: WindowFrameInput): void {
  const nativeSizeRef = useRef<LogicalWindowSize>({ width: 0, height: 0 });
  const guardUntilRef = useRef(0);
  useFrameFromSettings(input, nativeSizeRef, guardUntilRef);
  useSettingsFromNativeResize(input, nativeSizeRef, guardUntilRef);
}

function useFrameFromSettings(
  { windowWidth, windowHeight, previewOpen, miniMode, ready }: WindowFrameInput,
  nativeSizeRef: React.RefObject<LogicalWindowSize>,
  guardUntilRef: React.RefObject<number>,
): void {
  const wasMiniRef = useRef(false);
  useEffect(() => {
    if (!ready) return;
    if (miniMode) {
      wasMiniRef.current = true;
      guardUntilRef.current = Date.now() + PROGRAMMATIC_RESIZE_GUARD_MS;
      void collapseMainWindow();
      return;
    }
    const extra = previewOpen ? PREVIEW_EXTRA_WIDTH_PX : 0;
    const target = { width: windowWidth + extra, height: windowHeight };
    if (wasMiniRef.current) {
      wasMiniRef.current = false;
      guardUntilRef.current = Date.now() + PROGRAMMATIC_RESIZE_GUARD_MS;
      void expandMainWindow(target.width, target.height);
      return;
    }
    // Цель, совпадающая с эхом нативного размера, — «размер задал пользователь
    // мышью»: окно не трогаем вообще, иначе оно дёргалось бы под курсором.
    if (windowSizesEqual(target, nativeSizeEcho(nativeSizeRef.current, extra))) return;
    guardUntilRef.current = Date.now() + PROGRAMMATIC_RESIZE_GUARD_MS;
    void setWindowSize(target.width, target.height);
  }, [windowWidth, windowHeight, previewOpen, miniMode, ready, nativeSizeRef, guardUntilRef]);
}

function useSettingsFromNativeResize(
  { previewOpen, miniMode, ready, applyNativeWindowSize }: WindowFrameInput,
  nativeSizeRef: React.RefObject<LogicalWindowSize>,
  guardUntilRef: React.RefObject<number>,
): void {
  const previewOpenRef = useLatestRef(previewOpen);
  const miniModeRef = useLatestRef(miniMode);
  const readyRef = useLatestRef(ready);
  const applyRef = useLatestRef(applyNativeWindowSize);
  useEffect(() => {
    let pending = 0;
    // На Windows `WM_SIZE` приходит на каждый пиксель протяжки — коалесим в один кадр.
    const stop = onWindowResized((size) => {
      nativeSizeRef.current = size;
      if (!readyRef.current) return;
      if (miniModeRef.current) return;
      if (Date.now() < guardUntilRef.current) return;
      if (pending !== 0) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        if (miniModeRef.current) return;
        const latest = nativeSizeRef.current;
        const base = latest.width - (previewOpenRef.current ? PREVIEW_EXTRA_WIDTH_PX : 0);
        applyRef.current(base, latest.height);
      });
    });
    return () => {
      stop();
      cancelAnimationFrame(pending);
    };
  }, [nativeSizeRef, guardUntilRef, previewOpenRef, miniModeRef, readyRef, applyRef]);
}
