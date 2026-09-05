import { Check } from "lucide-react";
import { useState } from "react";
import { SectionLabel } from "@/components/SectionLabel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Chat, ChatPatch } from "@/lib/chats";
import {
  docsInFolder,
  rootDocs,
  type ContextDoc,
  type ContextLibrary,
} from "@/lib/context-library";
import { cn } from "@/lib/utils";

export interface ChatContextDialogProps {
  open: boolean;
  chat: Chat;
  library: ContextLibrary;
  onPatch: (chatId: string, patch: ChatPatch) => void;
  onClose: () => void;
  /** Куда вернуть каретку после закрытия — в поле промпта, а не на кнопку тулбара. */
  onRestoreFocus: () => void;
}

const DIALOG_WIDTH_PX = 480;
const LIBRARY_FILTER_MIN_DOCS = 8;
const LIBRARY_EMPTY_TEXT =
  "Библиотека пуста — материалы добавляются в лаунчере на экране «Контексты».";
const LIBRARY_NOTHING_FOUND_TEXT = "Ничего не найдено";
const LIBRARY_FILTER_PLACEHOLDER = "Найти материал…";
const NO_FOLDER_GROUP_NAME = "Без папки";

function LibraryDocToggle({
  doc,
  selected,
  onToggle,
}: {
  doc: ContextDoc;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-body transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        selected
          ? "bg-surface-active text-foreground"
          : "text-muted-foreground hover:bg-surface active:bg-surface-active",
      )}
    >
      <Check className={`size-3.5 shrink-0 ${selected ? "" : "opacity-0"}`} />
      <span className="min-w-0 truncate" title={doc.name}>
        {doc.name}
      </span>
    </button>
  );
}

interface DocGroup {
  id: string;
  name: string;
  docs: ContextDoc[];
}

function libraryGroups(library: ContextLibrary, query: string): DocGroup[] {
  const needle = query.trim().toLowerCase();
  const matches = (doc: ContextDoc) => needle === "" || doc.name.toLowerCase().includes(needle);
  return [
    {
      id: "",
      name: library.folders.length > 0 ? NO_FOLDER_GROUP_NAME : "",
      docs: rootDocs(library).filter(matches),
    },
    ...library.folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      docs: docsInFolder(library, folder.id).filter(matches),
    })),
  ].filter((group) => group.docs.length > 0);
}

function LibraryPicker({
  library,
  selectedDocIds,
  onToggleDoc,
}: {
  library: ContextLibrary;
  selectedDocIds: string[];
  onToggleDoc: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const groups = libraryGroups(library, query);
  const selected = new Set(selectedDocIds);

  if (library.docs.length === 0) {
    return <p className="text-caption text-muted-foreground">{LIBRARY_EMPTY_TEXT}</p>;
  }

  return (
    <div className="flex min-h-0 flex-col gap-1.5">
      {library.docs.length >= LIBRARY_FILTER_MIN_DOCS && (
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          placeholder={LIBRARY_FILTER_PLACEHOLDER}
          aria-label={LIBRARY_FILTER_PLACEHOLDER}
        />
      )}
      {groups.length === 0 ? (
        <p className="text-caption text-muted-foreground">{LIBRARY_NOTHING_FOUND_TEXT}</p>
      ) : (
        <div className="flex max-h-[min(12rem,32dvh)] min-h-0 flex-col gap-1 overflow-y-auto">
          {groups.map((g) => (
            <div key={g.id} className="flex flex-col gap-0.5">
              {g.name !== "" && (
                <SectionLabel className="truncate px-2 pt-1" title={g.name}>
                  {g.name}
                </SectionLabel>
              )}
              {g.docs.map((doc) => (
                <LibraryDocToggle
                  key={doc.id}
                  doc={doc}
                  selected={selected.has(doc.id)}
                  onToggle={() => {
                    onToggleDoc(doc.id);
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Черновик контекста живёт в самом диалоге и снимается с чата в момент
 * открытия (`key` по чату снаружи не нужен: диалог монтируется по `open`).
 * Сохранение пишет черновик в тот чат, для которого диалог открывали — даже
 * если пользователь успел переключить вкладку.
 */
function ChatContextForm({
  chat,
  library,
  onPatch,
  onClose,
}: Pick<ChatContextDialogProps, "chat" | "library" | "onPatch" | "onClose">) {
  const [draft, setDraft] = useState(chat.context);
  const [selectedDocIds, setSelectedDocIds] = useState(chat.libraryDocIds);
  const [chatId] = useState(chat.id);

  const toggleDoc = (id: string) => {
    setSelectedDocIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const save = () => {
    onPatch(chatId, { context: draft, libraryDocIds: selectedDocIds });
    onClose();
  };

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto">
        <div className="flex min-h-0 flex-col gap-1.5">
          <SectionLabel>
            Из библиотеки
            {selectedDocIds.length > 0 && (
              <span className="ml-1.5 text-muted-foreground tabular-nums">
                выбрано {selectedDocIds.length}
              </span>
            )}
          </SectionLabel>
          <LibraryPicker
            library={library}
            selectedDocIds={selectedDocIds}
            onToggleDoc={toggleDoc}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Свой текст</SectionLabel>
          <p className="text-caption text-muted-foreground">
            Уникальный справочный текст этого чата — уходит в системный промпт каждого запроса
            вместе с выбранными материалами.
          </p>
          <Textarea
            rows={6}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
            }}
            placeholder="Вставь сюда справочные материалы"
            className="max-h-40 overflow-y-auto"
          />
        </div>
      </div>
      <DialogFooter className="shrink-0">
        <Button variant="ghost" onClick={onClose}>
          Отмена
        </Button>
        <Button onClick={save}>Сохранить</Button>
      </DialogFooter>
    </>
  );
}

export function ChatContextDialog(props: ChatContextDialogProps) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent
        panelWidthPx={DIALOG_WIDTH_PX}
        className="flex flex-col overflow-hidden"
        // Radix возвращает фокус на кнопку тулбара ПОСЛЕ exit-анимации и
        // перебил бы наш rAF-возврат в поле промпта: отменяем и ставим сами.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          props.onRestoreFocus();
        }}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>Контекст чата</DialogTitle>
        </DialogHeader>
        {props.open && (
          <ChatContextForm
            chat={props.chat}
            library={props.library}
            onPatch={props.onPatch}
            onClose={props.onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
