import { Search, Upload } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/IconButton";
import { Input } from "@/components/ui/input";
import type { ContextLibraryApi } from "@/hooks/useContextLibrary";
import { useLibraryFileDrop } from "@/hooks/useLibraryFileDrop";
import { useLibraryImport } from "@/hooks/useLibraryImport";
import {
  folderNameOf,
  IMPORT_ACCEPT,
  ROOT_FOLDER_ID,
  type ContextLibrary,
} from "@/lib/context-library";
import { dropFolderProps } from "@/lib/library-drop";
import { noteRows, type NotesIndex } from "@/lib/notes-search";
import { cn } from "@/lib/utils";
import { EmptyLibraryHint, NoteBrowseList } from "./NoteBrowseList";
import { NoteReader } from "./NoteReader";
import { NoteSuggestions, SUGGESTIONS_ID } from "./NoteSuggestions";

const ESCAPE_KEY = "Escape";
const ARROW_DOWN_KEY = "ArrowDown";
const ARROW_UP_KEY = "ArrowUp";
const ENTER_KEY = "Enter";
const FIRST_ROW = 0;
const NO_TERMS: string[] = [];

export interface NotesPanelProps {
  library: ContextLibrary;
  index: NotesIndex | null;
  addDoc: ContextLibraryApi["addDoc"];
  selectedDocIds: string[];
  onToggleDoc: (docId: string) => void;
  onLeave: () => void;
}

export function NotesPanel({
  library,
  index,
  addDoc,
  selectedDocIds,
  onToggleDoc,
  onLeave,
}: NotesPanelProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState(FIRST_ROW);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { error: importError, importPaths, importFiles } = useLibraryImport(addDoc);
  const fileDropTarget = useLibraryFileDrop(importPaths);

  const rows = useMemo(() => noteRows(index, library.docs, query), [index, library.docs, query]);
  const suggesting = query.trim() !== "" && !suggestionsDismissed;
  const openDoc = library.docs.find((doc) => doc.id === openDocId) ?? null;
  const openTerms = rows.find((row) => row.doc.id === openDocId)?.terms ?? NO_TERMS;
  const inContext = useMemo(() => new Set(selectedDocIds), [selectedDocIds]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelectedRow(FIRST_ROW);
  }, [query]);

  const openNote = useCallback((docId: string) => {
    setOpenDocId(docId);
    setSuggestionsDismissed(true);
    searchRef.current?.focus();
  }, []);

  const stepBack = useCallback(() => {
    if (suggesting) {
      setSuggestionsDismissed(true);
      return;
    }
    if (openDoc !== null) {
      setOpenDocId(null);
      searchRef.current?.focus();
      return;
    }
    if (query !== "") {
      setQuery("");
      return;
    }
    onLeave();
  }, [suggesting, openDoc, query, onLeave]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== ESCAPE_KEY) return;
      if (e.defaultPrevented) return;
      e.preventDefault();
      stepBack();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [stepBack]);

  useEffect(() => {
    if (!suggesting) return;
    const onPointerDown = (e: MouseEvent) => {
      if (searchBoxRef.current?.contains(e.target as Node)) return;
      setSuggestionsDismissed(true);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [suggesting]);

  const onPickFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) importFiles(files, ROOT_FOLDER_ID);
    e.target.value = "";
  };

  const onSearchKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!suggesting) {
      if (e.key !== ARROW_DOWN_KEY || query.trim() === "") return;
      e.preventDefault();
      setSuggestionsDismissed(false);
      return;
    }
    if (rows.length === 0) return;
    if (e.key === ARROW_DOWN_KEY || e.key === ARROW_UP_KEY) {
      e.preventDefault();
      const step = e.key === ARROW_DOWN_KEY ? 1 : rows.length - 1;
      setSelectedRow((current) => (current + step) % rows.length);
      return;
    }
    if (e.key === ENTER_KEY) {
      e.preventDefault();
      e.stopPropagation();
      const row = rows[selectedRow];
      if (row) openNote(row.doc.id);
    }
  };

  const pickFiles = () => {
    fileInputRef.current?.click();
  };

  return (
    <section
      {...dropFolderProps(ROOT_FOLDER_ID)}
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-2 rounded-lg transition-colors",
        fileDropTarget !== null && "bg-primary/5 ring-1 ring-primary/40",
      )}
    >
      <div ref={searchBoxRef} className="relative z-20 flex shrink-0 items-center gap-1.5">
        <span className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSuggestionsDismissed(false);
            }}
            onKeyDown={onSearchKeyDown}
            role="combobox"
            aria-expanded={suggesting}
            aria-controls={SUGGESTIONS_ID}
            aria-autocomplete="list"
            spellCheck={false}
            placeholder={t("hud.notes.searchPlaceholder")}
            aria-label={t("hud.notes.searchPlaceholder")}
            className="h-7 pl-7 text-body"
          />
        </span>
        <IconButton
          title={t("hud.notes.importTitle")}
          className="size-6 shrink-0"
          onClick={pickFiles}
        >
          <Upload className="size-3.5" />
        </IconButton>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={IMPORT_ACCEPT}
          className="hidden"
          onChange={onPickFiles}
        />
        {suggesting && (
          <NoteSuggestions
            rows={rows}
            library={library}
            selectedRow={selectedRow}
            onOpen={openNote}
          />
        )}
      </div>

      {importError !== null && <p className="text-caption text-destructive">{importError}</p>}

      {openDoc ? (
        <NoteReader
          doc={openDoc}
          folderName={folderNameOf(library, openDoc.folderId)}
          terms={openTerms}
          inContext={inContext.has(openDoc.id)}
          onBack={() => {
            setOpenDocId(null);
            searchRef.current?.focus();
          }}
          onToggleContext={() => {
            onToggleDoc(openDoc.id);
          }}
          onCopy={() => {
            void navigator.clipboard.writeText(openDoc.text);
          }}
        />
      ) : library.docs.length === 0 ? (
        <EmptyLibraryHint onPick={pickFiles} />
      ) : (
        <NoteBrowseList
          library={library}
          inContext={inContext}
          onOpen={openNote}
          onToggleContext={onToggleDoc}
        />
      )}
    </section>
  );
}
