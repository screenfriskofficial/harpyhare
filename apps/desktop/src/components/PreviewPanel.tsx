import type { Viewport } from "@xyflow/react";
import { X } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/IconButton";
import { SectionLabel } from "@/components/SectionLabel";
import { Button } from "@/components/ui/button";
import { SystemDesignDiagramLoader } from "@/features/system-design/SystemDesignDiagramLoader";
import { usePreviewSrc } from "@/hooks/usePreviewSrc";
import { copyTextReportingError } from "@/lib/clipboard-text";
import type { PreviewContent } from "@/lib/html-blocks";
import { withPreviewCursor } from "@/lib/preview-cursor";
import {
  previewWidthBounds,
  SHELL_COLUMN_GAP_PX,
  type PreviewWidthBounds,
} from "@/lib/shell-layout";
import { cn } from "@/lib/utils";

export interface PreviewPanelProps {
  content: PreviewContent;
  /** Panel width in logical pixels, already clamped for the current window. */
  width: number;
  windowWidth: number;
  /** How far the arrow keys move the edge — the window's own resize step. */
  resizeStep: number;
  onResize: (width: number) => void;
  onClose: () => void;
  /** Pan and zoom of the diagram, kept across the panel's unmounts — see `usePreviewPanel`. */
  viewportMemory: RefObject<Viewport | null>;
}

const PREVIEW_IFRAME_CLASS = "min-h-0 flex-1 rounded-xl border-0 bg-white";
const PREVIEW_SANDBOX = "allow-scripts allow-same-origin";

function PreviewHeader({
  title,
  code,
  onClose,
}: {
  title: string;
  code: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <header className="flex min-h-7 items-center gap-1.5">
      <SectionLabel className="min-w-0 flex-1 truncate" title={title}>
        {title}
      </SectionLabel>
      <Button
        variant="ghost"
        size="compact"
        className="text-muted-foreground"
        onClick={() => void copyTextReportingError(code)}
      >
        {t("hud.preview.copyCode")}
      </Button>
      <IconButton title={t("common.close")} onClick={onClose}>
        <X />
      </IconButton>
    </header>
  );
}

/**
 * Arbitrary HTML from the model runs in a sandboxed iframe on its own origin
 * (see `usePreviewSrc`); it never touches the HUD document.
 */
function HtmlPreview({ html }: { html: string }) {
  const { t } = useTranslation();
  const prepared = useMemo(() => withPreviewCursor(html), [html]);
  const src = usePreviewSrc(prepared);
  return (
    <iframe
      sandbox={PREVIEW_SANDBOX}
      src={src}
      title={t("hud.preview.iframeTitle")}
      className={PREVIEW_IFRAME_CLASS}
    />
  );
}

/**
 * The panel's left edge sits in the gap between the columns. Dragging it left
 * widens the preview at the chat column's expense, dragging it right gives the
 * room back; the window itself never changes size here. Arrow keys do the same
 * from the keyboard.
 */
function PreviewSplitter({
  width,
  bounds,
  step,
  onResize,
}: {
  width: number;
  bounds: PreviewWidthBounds;
  step: number;
  onResize: (width: number) => void;
}) {
  const { t } = useTranslation();
  const [dragging, setDragging] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  useEffect(() => () => stopRef.current?.(), []);
  const onMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // Keeps the caret in the prompt and stops a text selection from starting.
    event.preventDefault();
    const startX = event.clientX;
    let frame = 0;
    let next = width;
    const move = (e: globalThis.MouseEvent) => {
      next = width + (startX - e.clientX);
      if (frame !== 0) return;
      // One relayout per frame: the chat column reflows its markdown on every width change.
      frame = requestAnimationFrame(() => {
        frame = 0;
        onResize(next);
      });
    };
    const stop = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", stop);
      cancelAnimationFrame(frame);
      stopRef.current = null;
      setDragging(false);
      onResize(next);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", stop);
    stopRef.current = stop;
    setDragging(true);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = event.key === "ArrowLeft" ? step : event.key === "ArrowRight" ? -step : 0;
    if (delta === 0) return;
    event.preventDefault();
    onResize(width + delta);
  };
  return (
    <>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("hud.preview.resize")}
        aria-valuemin={bounds.min}
        aria-valuemax={bounds.max}
        aria-valuenow={width}
        tabIndex={0}
        className="group absolute inset-y-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ left: -SHELL_COLUMN_GAP_PX, width: SHELL_COLUMN_GAP_PX }}
        onMouseDown={onMouseDown}
        onKeyDown={onKeyDown}
      >
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-2 left-1/2 w-px -translate-x-1/2 bg-border group-hover:bg-muted-foreground group-focus-visible:bg-muted-foreground",
            dragging && "bg-muted-foreground",
          )}
        />
      </div>
      {/* The preview iframe swallows mouse events over it; a shield keeps the drag alive across the whole window. */}
      {dragging && <div aria-hidden className="fixed inset-0 z-50" />}
    </>
  );
}

export function PreviewPanel({
  content,
  width,
  windowWidth,
  resizeStep,
  onResize,
  onClose,
  viewportMemory,
}: PreviewPanelProps) {
  const { t } = useTranslation();
  return (
    <aside className="relative flex flex-col gap-2.5" style={{ width }}>
      <PreviewSplitter
        width={width}
        bounds={previewWidthBounds(windowWidth)}
        step={resizeStep}
        onResize={onResize}
      />
      <PreviewHeader
        title={content.kind === "system-design" ? content.design.TITLE : t("hud.preview.title")}
        code={content.code}
        onClose={onClose}
      />
      {content.kind === "html" ? (
        <HtmlPreview html={content.html} />
      ) : (
        // Validated data, not markup: it is drawn by the app itself, with the
        // same canvas library as the pipeline editor, and needs no sandbox.
        <SystemDesignDiagramLoader design={content.design} viewportMemory={viewportMemory} />
      )}
    </aside>
  );
}
