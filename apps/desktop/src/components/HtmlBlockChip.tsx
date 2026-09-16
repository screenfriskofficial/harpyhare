import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { codeLineCount, linesLabel } from "@/lib/code-block";

export interface HtmlBlockChipProps {
  /** The fence language as written: `html` or `system-design`. */
  language: string;
  code: string;
  onToggle: () => void;
}

export function HtmlBlockChip({ language, code, onToggle }: HtmlBlockChipProps) {
  const { t } = useTranslation();
  const lines = codeLineCount(code);
  return (
    <button
      type="button"
      onClick={onToggle}
      className="my-1.5 flex items-center gap-2 rounded-md bg-code-surface px-2.5 py-1.5 font-mono text-caption text-muted-foreground ring-1 ring-border transition-colors outline-none ring-inset hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 active:bg-surface"
    >
      <span className="font-medium text-foreground/85">{language}</span>
      <span className="tabular-nums">{linesLabel(lines)}</span>
      <span className="flex items-center gap-1">
        {t("hud.codeBlock.openPreview")} <ExternalLink className="size-3" />
      </span>
    </button>
  );
}
