import { useCallback, useState } from "react";
import { useLatestRef } from "./useLatestRef";

export interface PreviewPanelState {
  previewHtml: string;
  previewOpen: boolean;
  openPreview: (code: string) => void;
  /** Повторный клик по тому же блоку закрывает панель, по другому — подменяет содержимое. */
  togglePreview: (code: string) => void;
  closePreview: () => void;
}

export function usePreviewPanel(): PreviewPanelState {
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const currentRef = useLatestRef({ html: previewHtml, open: previewOpen });

  const openPreview = useCallback((code: string) => {
    setPreviewHtml(code);
    setPreviewOpen(true);
  }, []);

  const togglePreview = useCallback(
    (code: string) => {
      if (currentRef.current.open && currentRef.current.html === code) {
        setPreviewOpen(false);
      } else {
        setPreviewHtml(code);
        setPreviewOpen(true);
      }
    },
    [currentRef],
  );

  const closePreview = useCallback(() => {
    setPreviewOpen(false);
  }, []);

  return { previewHtml, previewOpen, openPreview, togglePreview, closePreview };
}
