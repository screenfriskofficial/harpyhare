import type { Viewport } from "@xyflow/react";
import { useCallback, useRef, useState, type RefObject } from "react";
import { samePreview, type PreviewContent } from "@/lib/html-blocks";
import { useLatestRef } from "./useLatestRef";

export interface PreviewPanelState {
  previewContent: PreviewContent | null;
  previewOpen: boolean;
  openPreview: (content: PreviewContent) => void;
  /** Повторный клик по тому же блоку закрывает панель, по другому — подменяет содержимое. */
  togglePreview: (content: PreviewContent) => void;
  closePreview: () => void;
  /**
   * Where the current preview's diagram was panned and zoomed to. The panel
   * unmounts in mini mode and on close, but this ref lives with the chat:
   * returning to the same diagram opens it where it was, another one starts fresh.
   */
  viewportMemory: RefObject<Viewport | null>;
}

export function usePreviewPanel(): PreviewPanelState {
  const [previewContent, setPreviewContent] = useState<PreviewContent | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const currentRef = useLatestRef({ content: previewContent, open: previewOpen });
  const viewportMemory = useRef<Viewport | null>(null);

  const show = useCallback(
    (content: PreviewContent) => {
      const current = currentRef.current.content;
      if (current === null || !samePreview(current, content)) viewportMemory.current = null;
      setPreviewContent(content);
      setPreviewOpen(true);
    },
    [currentRef],
  );

  const togglePreview = useCallback(
    (content: PreviewContent) => {
      const current = currentRef.current;
      if (current.open && current.content !== null && samePreview(current.content, content)) {
        setPreviewOpen(false);
      } else {
        show(content);
      }
    },
    [currentRef, show],
  );

  const closePreview = useCallback(() => {
    setPreviewOpen(false);
  }, []);

  return {
    previewContent,
    previewOpen,
    openPreview: show,
    togglePreview,
    closePreview,
    viewportMemory,
  };
}
