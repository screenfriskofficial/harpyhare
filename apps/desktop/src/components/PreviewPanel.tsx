import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/IconButton";
import { SectionLabel } from "@/components/SectionLabel";
import { Button } from "@/components/ui/button";
import { usePreviewSrc } from "@/hooks/usePreviewSrc";
import { copyTextReportingError } from "@/lib/clipboard-text";

export interface PreviewPanelProps {
  html: string;
  onClose: () => void;
}

export const PREVIEW_PANEL_WIDTH_PX = 570;

const PREVIEW_IFRAME_CLASS = "min-h-0 flex-1 rounded-xl border-0 bg-white";
const PREVIEW_SANDBOX = "allow-scripts allow-same-origin";

function PreviewHeader({ html, onClose }: { html: string; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <header className="flex min-h-7 items-center gap-1.5">
      <SectionLabel className="min-w-0 flex-1 truncate">{t("hud.preview.title")}</SectionLabel>
      <Button
        variant="ghost"
        size="compact"
        className="text-muted-foreground"
        onClick={() => void copyTextReportingError(html)}
      >
        {t("hud.preview.copyCode")}
      </Button>
      <IconButton title={t("common.close")} onClick={onClose}>
        <X />
      </IconButton>
    </header>
  );
}

function PreviewBody({ html, src }: { html: string; src: string }) {
  const { t } = useTranslation();
  if (html === "") {
    return (
      <div className="grid flex-1 place-items-center">
        <span className="text-body text-muted-foreground">{t("hud.preview.empty")}</span>
      </div>
    );
  }
  return (
    <iframe
      sandbox={PREVIEW_SANDBOX}
      src={src}
      title={t("hud.preview.iframeTitle")}
      className={PREVIEW_IFRAME_CLASS}
    />
  );
}

export function PreviewPanel({ html, onClose }: PreviewPanelProps) {
  const src = usePreviewSrc(html);

  return (
    <aside className="flex flex-col gap-2.5" style={{ width: PREVIEW_PANEL_WIDTH_PX }}>
      <PreviewHeader html={html} onClose={onClose} />
      <PreviewBody html={html} src={src} />
    </aside>
  );
}
