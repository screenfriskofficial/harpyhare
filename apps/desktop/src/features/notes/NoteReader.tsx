import { ArrowLeft, Check, Copy, Plus } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/IconButton";
import { markdownComponents, PROSE_MARKDOWN_CLASS } from "@/components/markdown-config";
import { MarkdownChunk } from "@/components/MarkdownChunk";
import type { ContextDoc } from "@/lib/context-library";
import { noteMatchCount } from "@/lib/notes-excerpt";
import { cn } from "@/lib/utils";

export interface NoteReaderProps {
  doc: ContextDoc;
  folderName: string | null;
  terms: string[];
  inContext: boolean;
  onBack: () => void;
  onToggleContext: () => void;
  onCopy: () => void;
}

export function NoteReader({
  doc,
  folderName,
  terms,
  inContext,
  onBack,
  onToggleContext,
  onCopy,
}: NoteReaderProps) {
  const { t } = useTranslation();
  const matches = useMemo(() => noteMatchCount(doc.text, terms), [doc.text, terms]);
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-1.5">
      <header className="flex items-center gap-1.5 border-b pb-1.5">
        <IconButton title={t("hud.notes.back")} className="size-6 shrink-0" onClick={onBack}>
          <ArrowLeft className="size-3.5" />
        </IconButton>
        <span className="min-w-0 truncate text-body font-medium text-foreground">{doc.name}</span>
        {folderName !== null && (
          <span className="shrink-0 truncate text-hint text-muted-foreground">{folderName}</span>
        )}
        <span className="min-w-0 flex-1" />
        {matches > 0 && (
          <span className="shrink-0 text-hint text-muted-foreground tabular-nums">
            {t("hud.notes.matches", { count: matches })}
          </span>
        )}
        <IconButton
          title={inContext ? t("hud.notes.removeFromContext") : t("hud.notes.addToContext")}
          className={cn("size-6 shrink-0", inContext && "text-foreground")}
          onClick={onToggleContext}
        >
          {inContext ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
        </IconButton>
        <IconButton title={t("hud.notes.copy")} className="size-6 shrink-0" onClick={onCopy}>
          <Copy className="size-3.5" />
        </IconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1.5">
        {doc.text.trim() === "" ? (
          <p className="text-caption text-muted-foreground">{t("hud.notes.emptyNote")}</p>
        ) : (
          <div className={PROSE_MARKDOWN_CLASS}>
            <MarkdownChunk text={doc.text} components={markdownComponents} />
          </div>
        )}
      </div>
    </section>
  );
}
