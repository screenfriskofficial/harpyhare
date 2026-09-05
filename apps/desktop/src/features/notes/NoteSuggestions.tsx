import { useTranslation } from "react-i18next";
import { folderNameOf, type ContextLibrary } from "@/lib/context-library";
import type { NoteRow } from "@/lib/notes-search";
import { NoteResultRow } from "./NoteResultRow";

export const SUGGESTIONS_ID = "note-suggestions";

export interface NoteSuggestionsProps {
  rows: NoteRow[];
  library: ContextLibrary;
  selectedRow: number;
  onOpen: (docId: string) => void;
}

export function NoteSuggestions({ rows, library, selectedRow, onOpen }: NoteSuggestionsProps) {
  const { t } = useTranslation();
  return (
    <div
      data-no-drag
      id={SUGGESTIONS_ID}
      role="listbox"
      aria-label={t("hud.notes.suggestions")}
      className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl bg-popover shadow-pop ring-1 ring-border ring-inset"
    >
      {rows.length === 0 ? (
        <div className="flex flex-col gap-1 px-3 py-4 text-center">
          <span className="text-body text-foreground">{t("common.nothingFound")}</span>
          <span className="text-caption text-muted-foreground">
            {t("hud.notes.nothingFoundHint")}
          </span>
        </div>
      ) : (
        <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto p-1">
          {rows.map((row, i) => (
            <NoteResultRow
              key={row.doc.id}
              doc={row.doc}
              terms={row.terms}
              folderName={folderNameOf(library, row.doc.folderId)}
              selected={i === selectedRow}
              inContext={false}
              option
              onOpen={() => {
                onOpen(row.doc.id);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
