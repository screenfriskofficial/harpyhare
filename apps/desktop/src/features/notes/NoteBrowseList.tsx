import { NotebookText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SectionLabel } from "@/components/SectionLabel";
import {
  docsInFolder,
  rootDocs,
  type ContextDoc,
  type ContextLibrary,
} from "@/lib/context-library";
import { fileManagerLabel } from "@/lib/platform";
import { NoteResultRow } from "./NoteResultRow";

const NO_TERMS: string[] = [];

interface DocGroup {
  id: string;
  label: string | null;
  docs: ContextDoc[];
}

function docGroups(library: ContextLibrary, rootLabel: string): DocGroup[] {
  const foldered = library.folders.map((folder) => ({
    id: folder.id,
    label: folder.name,
    docs: docsInFolder(library, folder.id),
  }));
  const rootGroup: DocGroup = {
    id: "",
    label: foldered.length > 0 ? rootLabel : null,
    docs: rootDocs(library),
  };
  return [rootGroup, ...foldered].filter((group) => group.docs.length > 0);
}

export function EmptyLibraryHint({ onPick }: { onPick: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-7 text-center outline-none hover:border-foreground/30 hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <span className="grid size-9 place-items-center rounded-lg bg-surface ring-1 ring-border ring-inset">
        <NotebookText className="size-4 text-muted-foreground" aria-hidden />
      </span>
      <span className="text-body text-foreground">{t("hud.notes.empty")}</span>
      <span className="text-caption text-muted-foreground">
        {t("hud.notes.dropHint", { fileManager: fileManagerLabel() })}
      </span>
    </button>
  );
}

export interface NoteBrowseListProps {
  library: ContextLibrary;
  inContext: ReadonlySet<string>;
  onOpen: (docId: string) => void;
  onToggleContext: (docId: string) => void;
}

export function NoteBrowseList({
  library,
  inContext,
  onOpen,
  onToggleContext,
}: NoteBrowseListProps) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1.5">
      {docGroups(library, t("common.noFolder")).map((group) => (
        <div key={group.id} className="flex flex-col gap-0.5">
          {group.label !== null && (
            <SectionLabel className="px-1.5 pt-1">{group.label}</SectionLabel>
          )}
          {group.docs.map((doc) => (
            <NoteResultRow
              key={doc.id}
              doc={doc}
              terms={NO_TERMS}
              folderName={null}
              selected={false}
              inContext={inContext.has(doc.id)}
              onOpen={() => {
                onOpen(doc.id);
              }}
              onToggleContext={() => {
                onToggleContext(doc.id);
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
