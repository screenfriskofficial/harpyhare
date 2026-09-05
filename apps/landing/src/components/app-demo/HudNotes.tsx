import { ArrowLeft, Check, Copy, FileText, NotebookText, Plus, Search, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { LibraryDocCopy } from "@/i18n/demo-types";
import { cn } from "@/lib/cn";
import { useCopy } from "./copy";
import { copyText } from "./HudMarkdown";
import { AppIconButton, SectionLabel } from "./ui";

const HIDDEN_UNTIL_HOVER_CLASS = "opacity-0 group-hover:opacity-100 focus-visible:opacity-100";
const EXCERPT_MAX_CHARS = 120;

function folded(text: string): string {
  return text.toLowerCase().replace(/ё/g, "е");
}

/** Поиск по началу слова, как MiniSearch в приложении: «сверк» находит «сверка». */
function matchesQuery(doc: LibraryDocCopy, query: string): boolean {
  const terms = folded(query)
    .split(/\s+/)
    .filter((t) => t !== "");
  if (terms.length === 0) return true;
  const words = folded(`${doc.name} ${doc.text}`).split(/[^\p{L}\p{N}]+/u);
  return terms.every((term) => words.some((word) => word.startsWith(term)));
}

function excerpt(doc: LibraryDocCopy, query: string): string {
  const flat = doc.text.replace(/\s+/g, " ").trim();
  const term = folded(query)
    .split(/\s+/)
    .find((t) => t !== "");
  const at = term === undefined ? -1 : folded(flat).indexOf(term);
  const start = at < 0 ? 0 : Math.max(0, at - 48);
  const slice = flat.slice(start, start + EXCERPT_MAX_CHARS);
  return `${start > 0 ? "…" : ""}${slice}${start + EXCERPT_MAX_CHARS < flat.length ? "…" : ""}`;
}

function NoteRow({
  doc,
  query,
  inContext,
  onOpen,
  onToggle,
}: {
  doc: LibraryDocCopy;
  query: string;
  inContext: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const copy = useCopy().hud.notes;
  return (
    <div className="group flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-app-surface">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-sm py-0.5 text-left outline-none"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <FileText className="size-3.5 shrink-0 text-app-muted" aria-hidden />
          <span className="min-w-0 truncate text-app-body text-app-fg">{doc.name}</span>
          <span className="shrink-0 truncate text-app-hint text-app-muted">{doc.folder}</span>
        </span>
        {query.trim() !== "" && (
          <span className="line-clamp-2 text-app-caption text-app-muted">
            {excerpt(doc, query)}
          </span>
        )}
      </button>
      <AppIconButton
        title={inContext ? copy.removeFromContext : copy.addToContext}
        className={cn(
          "size-6 shrink-0 [&_svg]:size-3.5",
          inContext ? "text-app-fg" : HIDDEN_UNTIL_HOVER_CLASS,
        )}
        onClick={onToggle}
      >
        {inContext ? <Check /> : <Plus />}
      </AppIconButton>
    </div>
  );
}

function NoteReader({
  doc,
  inContext,
  onBack,
  onToggle,
}: {
  doc: LibraryDocCopy;
  inContext: boolean;
  onBack: () => void;
  onToggle: () => void;
}) {
  const copy = useCopy().hud.notes;
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-1.5">
      <header className="flex items-center gap-1.5 border-b border-app-border pb-1.5">
        <AppIconButton
          title={copy.back}
          className="size-6 shrink-0 [&_svg]:size-3.5"
          onClick={onBack}
        >
          <ArrowLeft />
        </AppIconButton>
        <span className="min-w-0 truncate text-app-body font-medium text-app-fg">{doc.name}</span>
        <span className="shrink-0 truncate text-app-hint text-app-muted">{doc.folder}</span>
        <span className="min-w-0 flex-1" />
        <AppIconButton
          title={inContext ? copy.removeFromContext : copy.addToContext}
          className={cn("size-6 shrink-0 [&_svg]:size-3.5", inContext && "text-app-fg")}
          onClick={onToggle}
        >
          {inContext ? <Check /> : <Plus />}
        </AppIconButton>
        <AppIconButton
          title={copy.copy}
          className="size-6 shrink-0 [&_svg]:size-3.5"
          onClick={() => void copyText(doc.text)}
        >
          <Copy />
        </AppIconButton>
      </header>
      <div className="app-scroll min-h-0 flex-1 overflow-y-auto pr-1.5">
        <p className="app-prose text-app-chat leading-relaxed text-app-fg">{doc.text}</p>
      </div>
    </section>
  );
}

/** Режим заметок: поиск по материалам библиотеки, чтение и добавление в контекст чата. */
export function HudNotes({
  selectedDocIds,
  onToggleDoc,
  onLeave,
}: {
  selectedDocIds: string[];
  onToggleDoc: (id: string) => void;
  onLeave: () => void;
}) {
  const copy = useCopy();
  const notes = copy.hud.notes;
  const docs = copy.launcher.contexts.docs;
  const folders = copy.launcher.contexts.folders;
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const openDoc = docs.find((doc) => doc.id === openId) ?? null;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (openId !== null) setOpenId(null);
      else if (query !== "") setQuery("");
      else onLeave();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [openId, query, onLeave]);

  const visible = docs.filter((doc) => matchesQuery(doc, query));
  const grouped = folders
    .map((folder) => ({ folder, docs: visible.filter((doc) => doc.folder === folder) }))
    .filter((group) => group.docs.length > 0);

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-app-muted"
            aria-hidden
          />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpenId(null);
            }}
            placeholder={notes.searchPlaceholder}
            aria-label={notes.searchPlaceholder}
            className="h-8 w-full min-w-0 rounded-md border border-app-border bg-app-surface/40 pr-2.5 pl-8 text-app-body text-app-fg outline-none placeholder:text-app-muted/60 focus-visible:border-app-ring focus-visible:ring-2 focus-visible:ring-app-ring/40"
          />
        </div>
        <AppIconButton title={notes.importTitle}>
          <Upload />
        </AppIconButton>
      </div>
      {openDoc ? (
        <NoteReader
          doc={openDoc}
          inContext={selectedDocIds.includes(openDoc.id)}
          onBack={() => {
            setOpenId(null);
          }}
          onToggle={() => {
            onToggleDoc(openDoc.id);
          }}
        />
      ) : (
        <div className="app-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1.5">
          {grouped.length === 0 ? (
            <div className="flex flex-col items-center gap-1 px-3 py-6 text-center">
              <NotebookText className="size-4 text-app-muted" aria-hidden />
              <span className="text-app-body text-app-fg">{notes.nothingFound}</span>
              <span className="text-app-caption text-app-muted">{notes.nothingFoundHint}</span>
            </div>
          ) : (
            grouped.map((group) => (
              <div key={group.folder} className="flex flex-col gap-0.5">
                <SectionLabel className="px-1.5">{group.folder}</SectionLabel>
                {group.docs.map((doc) => (
                  <NoteRow
                    key={doc.id}
                    doc={doc}
                    query={query}
                    inContext={selectedDocIds.includes(doc.id)}
                    onOpen={() => {
                      setOpenId(doc.id);
                    }}
                    onToggle={() => {
                      onToggleDoc(doc.id);
                    }}
                  />
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
