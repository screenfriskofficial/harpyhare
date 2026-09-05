import {
  FileText,
  Folder,
  FolderPlus,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/IconButton";
import { SectionLabel } from "@/components/SectionLabel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ContextLibraryApi } from "@/hooks/useContextLibrary";
import { useLibraryFileDrop } from "@/hooks/useLibraryFileDrop";
import { useLibraryImport } from "@/hooks/useLibraryImport";
import { t } from "@/i18n";
import {
  docsInFolder,
  IMPORT_ACCEPT,
  ROOT_FOLDER_ID,
  rootDocs,
  type ContextDoc,
} from "@/lib/context-library";
import { dropFolderProps, dropTargetAt } from "@/lib/library-drop";
import { fileManagerLabel } from "@/lib/platform";
import { cn } from "@/lib/utils";

const ROOT_SELECT_VALUE = "root";
const THOUSAND = 1000;

interface DocDraft {
  id: string | null;
  name: string;
  text: string;
  folderId: string;
}

/** До тысячи — точное число, дальше «тыс.» с одним знаком; разряды форматирует язык интерфейса. */
function formatChars(count: number): string {
  if (count < THOUSAND) return t("units.chars", { count });
  return t("units.thousandChars", { count: count / THOUSAND });
}

const DOC_DRAG_THRESHOLD_PX = 5;

interface DocDragApi {
  dragDocId: string | null;
  dragTargetId: string | null;
  startDrag: (docId: string, x: number, y: number) => void;
}

function useDocDrag(moveDoc: ContextLibraryApi["moveDoc"]): DocDragApi {
  const [dragDocId, setDragDocId] = useState<string | null>(null);
  const [dragTargetId, setDragTargetId] = useState<string | null>(null);

  const startDrag = useCallback(
    (docId: string, startX: number, startY: number) => {
      let active = false;
      const onMove = (e: MouseEvent) => {
        if (!active && Math.hypot(e.clientX - startX, e.clientY - startY) < DOC_DRAG_THRESHOLD_PX)
          return;
        if (!active) {
          active = true;
          setDragDocId(docId);
        }
        setDragTargetId(dropTargetAt(e.clientX, e.clientY));
      };
      const onUp = (e: MouseEvent) => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        if (active) {
          const target = dropTargetAt(e.clientX, e.clientY);
          if (target !== null) moveDoc(docId, target);
        }
        setDragDocId(null);
        setDragTargetId(null);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [moveDoc],
  );

  return { dragDocId, dragTargetId, startDrag };
}

function RowIconBadge({ children }: { children: ReactNode }) {
  return (
    <span className="grid size-6 shrink-0 place-items-center rounded-sm bg-surface">
      {children}
    </span>
  );
}

function RowActions({
  onEdit,
  onRemove,
  editTitle,
  removeTitle,
}: {
  onEdit?: () => void;
  onRemove: () => void;
  editTitle?: string;
  removeTitle: string;
}) {
  return (
    <div className="pointer-events-none flex shrink-0 items-center gap-1 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
      {onEdit && (
        <IconButton title={editTitle ?? ""} className="size-6" onClick={onEdit}>
          <Pencil className="size-3.5" />
        </IconButton>
      )}
      <IconButton title={removeTitle} className="size-6 hover:text-destructive" onClick={onRemove}>
        <Trash2 className="size-3.5" />
      </IconButton>
    </div>
  );
}

function DocRow({
  doc,
  dragging,
  onDragStart,
  onEdit,
  onRemove,
}: {
  doc: ContextDoc;
  dragging: boolean;
  onDragStart: (x: number, y: number) => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const onMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (e.target instanceof Element && e.target.closest("button")) return;
    e.preventDefault();
    onDragStart(e.clientX, e.clientY);
  };
  return (
    <div
      onMouseDown={onMouseDown}
      title={t("launcher.contexts.dragHint")}
      className={cn(
        "group flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-surface active:bg-surface-active",
        dragging && "opacity-40",
      )}
    >
      <GripVertical className="size-3.5 shrink-0 text-muted-foreground/35 transition-colors group-hover:text-muted-foreground" />
      <RowIconBadge>
        <FileText className="size-3.5 text-muted-foreground" />
      </RowIconBadge>
      <span className="min-w-0 flex-1 truncate text-body">{doc.name}</span>
      <span className="shrink-0 text-hint text-muted-foreground">
        {formatChars(doc.text.length)}
      </span>
      <RowActions
        onEdit={onEdit}
        editTitle={t("launcher.contexts.edit")}
        onRemove={onRemove}
        removeTitle={t("launcher.contexts.removeDoc")}
      />
    </div>
  );
}

function FolderHeader({
  name,
  docCount,
  onRename,
  onRemove,
}: {
  name: string;
  docCount: number;
  onRename: (name: string) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  return (
    <div className="group flex items-center gap-2 px-1.5 py-1">
      <RowIconBadge>
        <Folder className="size-3.5 text-muted-foreground" />
      </RowIconBadge>
      {editing ? (
        <Input
          autoFocus
          value={draft}
          className="h-6 flex-1 text-body"
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          onBlur={() => {
            onRename(draft);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setDraft(name);
              setEditing(false);
            }
          }}
        />
      ) : (
        <>
          <span className="min-w-0 truncate text-body font-medium">{name}</span>
          <span className="shrink-0 rounded-full bg-surface px-1.5 py-px text-hint text-muted-foreground">
            {docCount}
          </span>
          <span className="flex-1" />
        </>
      )}
      {!editing && (
        <RowActions
          onEdit={() => {
            setDraft(name);
            setEditing(true);
          }}
          editTitle={t("launcher.contexts.renameFolder")}
          onRemove={onRemove}
          removeTitle={t("launcher.contexts.removeFolder")}
        />
      )}
    </div>
  );
}

function DocEditor({
  draft,
  folders,
  onChange,
  onSave,
  onCancel,
}: {
  draft: DocDraft;
  folders: { id: string; name: string }[];
  onChange: (d: DocDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-card p-3 shadow-raise ring-1 ring-border ring-inset">
      <SectionLabel>
        {draft.id === null ? t("launcher.contexts.newDoc") : t("launcher.contexts.doc")}
      </SectionLabel>
      <div className="flex gap-2">
        <Input
          autoFocus
          placeholder={t("launcher.contexts.docNamePlaceholder")}
          value={draft.name}
          onChange={(e) => {
            onChange({ ...draft, name: e.target.value });
          }}
        />
        <Select
          value={draft.folderId === ROOT_FOLDER_ID ? ROOT_SELECT_VALUE : draft.folderId}
          onValueChange={(v) => {
            onChange({ ...draft, folderId: v === ROOT_SELECT_VALUE ? ROOT_FOLDER_ID : v });
          }}
        >
          <SelectTrigger className="w-[160px] shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value={ROOT_SELECT_VALUE}>{t("common.noFolder")}</SelectItem>
            {folders.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {f.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Textarea
        rows={8}
        placeholder={t("launcher.contexts.docTextPlaceholder")}
        value={draft.text}
        onChange={(e) => {
          onChange({ ...draft, text: e.target.value });
        }}
        className="max-h-56 overflow-y-auto"
      />
      <div className="flex items-center justify-between">
        <span className="text-hint text-muted-foreground">{formatChars(draft.text.length)}</span>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" onClick={onSave}>
            {t("common.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function EmptyDropZone({ onPick }: { onPick: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onPick}
      {...dropFolderProps(ROOT_FOLDER_ID)}
      className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-7 text-center transition-colors outline-none hover:border-foreground/30 hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <span className="grid size-9 place-items-center rounded-lg bg-surface ring-1 ring-border ring-inset">
        <Upload className="size-4 text-muted-foreground" />
      </span>
      <span className="text-body text-foreground">
        {t("launcher.contexts.dropHint", { fileManager: fileManagerLabel() })}
      </span>
      <span className="text-caption text-muted-foreground">
        {t("launcher.contexts.addAsTextHint")}
      </span>
    </button>
  );
}

const SUMMARY_SEPARATOR = " · ";

function librarySummary(docCount: number, folderCount: number): string {
  if (docCount === 0 && folderCount === 0) return t("launcher.contexts.libraryEmpty");
  const docs = t("launcher.contexts.summaryDocs", { count: docCount });
  if (folderCount === 0) return docs;
  return [docs, t("launcher.contexts.summaryFolders", { count: folderCount })].join(
    SUMMARY_SEPARATOR,
  );
}

export function ContextLibraryPanel({ api }: { api: ContextLibraryApi }) {
  const { t } = useTranslation();
  const { library } = api;
  const [docDraft, setDocDraft] = useState<DocDraft | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { error: importError, importPaths, importFiles } = useLibraryImport(api.addDoc);
  const fileDropTarget = useLibraryFileDrop(importPaths);
  const { dragDocId, dragTargetId, startDrag } = useDocDrag(api.moveDoc);
  const dropTarget = fileDropTarget ?? dragTargetId;

  const saveDocDraft = () => {
    if (!docDraft) return;
    if (docDraft.id === null) {
      api.addDoc({ name: docDraft.name, text: docDraft.text, folderId: docDraft.folderId });
    } else {
      api.updateDoc(docDraft.id, { name: docDraft.name, text: docDraft.text });
      api.moveDoc(docDraft.id, docDraft.folderId);
    }
    setDocDraft(null);
  };

  const onPickFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) importFiles(files, ROOT_FOLDER_ID);
    e.target.value = "";
  };

  const empty = library.docs.length === 0 && library.folders.length === 0;
  const roots = rootDocs(library);
  const folderBlocks = library.folders.map((f) => ({
    folder: f,
    docs: docsInFolder(library, f.id),
  }));

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-caption text-muted-foreground">
          {librarySummary(library.docs.length, library.folders.length)}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="compact"
            onClick={() => {
              setDocDraft({ id: null, name: "", text: "", folderId: ROOT_FOLDER_ID });
            }}
          >
            <Plus /> {t("launcher.contexts.addDoc")}
          </Button>
          <Button
            variant="ghost"
            size="compact"
            onClick={() => {
              api.addFolder(
                t("launcher.contexts.folderName", { number: library.folders.length + 1 }),
              );
            }}
          >
            <FolderPlus /> {t("launcher.contexts.addFolder")}
          </Button>
          <Button
            variant="ghost"
            size="compact"
            onClick={() => {
              fileInputRef.current?.click();
            }}
          >
            <Upload /> {t("launcher.contexts.import")}
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={IMPORT_ACCEPT}
          className="hidden"
          onChange={onPickFiles}
        />
      </div>

      {importError !== null && <p className="text-caption text-destructive">{importError}</p>}

      {docDraft && (
        <DocEditor
          draft={docDraft}
          folders={library.folders}
          onChange={setDocDraft}
          onSave={saveDocDraft}
          onCancel={() => {
            setDocDraft(null);
          }}
        />
      )}

      {empty && !docDraft ? (
        <EmptyDropZone
          onPick={() => {
            fileInputRef.current?.click();
          }}
        />
      ) : (
        <>
          <div
            {...dropFolderProps(ROOT_FOLDER_ID)}
            className={cn(
              "flex flex-col gap-0.5 rounded-lg p-1 transition-colors",
              dropTarget === ROOT_FOLDER_ID && "bg-primary/5 ring-1 ring-primary/40",
            )}
          >
            {library.folders.length > 0 && (
              <SectionLabel className="px-1.5 pt-0.5 pb-1">{t("common.noFolder")}</SectionLabel>
            )}
            {roots.length === 0 && (
              <p className="px-1.5 pb-1 text-caption text-muted-foreground">
                {t("launcher.contexts.dropRootHint")}
              </p>
            )}
            {roots.map((doc) => (
              <DocRow
                key={doc.id}
                doc={doc}
                dragging={dragDocId === doc.id}
                onDragStart={(x, y) => {
                  startDrag(doc.id, x, y);
                }}
                onEdit={() => {
                  setDocDraft({
                    id: doc.id,
                    name: doc.name,
                    text: doc.text,
                    folderId: doc.folderId,
                  });
                }}
                onRemove={() => {
                  api.removeDoc(doc.id);
                }}
              />
            ))}
          </div>

          {folderBlocks.map(({ folder, docs }) => (
            <div
              key={folder.id}
              {...dropFolderProps(folder.id)}
              className={cn(
                "flex flex-col gap-0.5 rounded-lg bg-card p-1.5 shadow-raise ring-1 ring-border transition-colors ring-inset",
                dropTarget === folder.id && "bg-primary/5 ring-primary/40",
              )}
            >
              <FolderHeader
                name={folder.name}
                docCount={docs.length}
                onRename={(name) => {
                  api.renameFolder(folder.id, name);
                }}
                onRemove={() => {
                  api.removeFolder(folder.id);
                }}
              />
              <div className="ml-4 flex flex-col gap-0.5 border-l pl-2">
                {docs.length === 0 && (
                  <p className="px-1.5 py-1 text-caption text-muted-foreground">
                    {t("launcher.contexts.dropFolderHint")}
                  </p>
                )}
                {docs.map((doc) => (
                  <DocRow
                    key={doc.id}
                    doc={doc}
                    dragging={dragDocId === doc.id}
                    onDragStart={(x, y) => {
                      startDrag(doc.id, x, y);
                    }}
                    onEdit={() => {
                      setDocDraft({
                        id: doc.id,
                        name: doc.name,
                        text: doc.text,
                        folderId: doc.folderId,
                      });
                    }}
                    onRemove={() => {
                      api.removeDoc(doc.id);
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
