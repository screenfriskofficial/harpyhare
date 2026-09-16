import { FileText } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import type { ContextDoc } from "@/lib/context-library";
import { noteExcerpt, type ExcerptPart } from "@/lib/notes-excerpt";
import { cn } from "@/lib/utils";

function ExcerptText({ parts }: { parts: ExcerptPart[] }) {
  return (
    <span className="line-clamp-2 text-caption text-muted-foreground">
      {parts.map((part, i) =>
        part.match ? (
          <mark key={i} className="rounded-sm bg-primary/30 text-foreground">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </span>
  );
}

export interface NoteResultRowProps {
  doc: ContextDoc;
  terms: string[];
  folderName: string | null;
  selected: boolean;
  onOpen: () => void;
  option?: boolean;
}

export function NoteResultRow({
  doc,
  terms,
  folderName,
  selected,
  onOpen,
  option = false,
}: NoteResultRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const excerpt = useMemo(() => noteExcerpt(doc.text, terms), [doc.text, terms]);
  const showExcerpt = terms.length > 0 && excerpt.length > 0;
  return (
    <div
      ref={rowRef}
      className={cn(
        "flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors",
        selected ? "bg-surface-active" : "hover:bg-surface",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        {...(option ? { role: "option", "aria-selected": selected } : {})}
        className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-sm py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 truncate text-body text-foreground">{doc.name}</span>
          {folderName !== null && (
            <span className="shrink-0 truncate text-hint text-muted-foreground">{folderName}</span>
          )}
        </span>
        {showExcerpt && <ExcerptText parts={excerpt} />}
      </button>
    </div>
  );
}
