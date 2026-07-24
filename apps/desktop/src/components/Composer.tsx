import {
  ArrowUp,
  Check,
  Eraser,
  NotebookText,
  RotateCcw,
  SlidersHorizontal,
  Square,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { SectionLabel } from "@/components/SectionLabel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Chat, ChatPatch } from "@/lib/chats";
import { extractImageItems } from "@/lib/composer";
import type { Attachment } from "@/lib/composer";
import {
  docsInFolder,
  rootDocs,
  type ContextDoc,
  type ContextLibrary,
} from "@/lib/context-library";
import { modelLabel, selectableModels, thinkingLocked, type ModelInfo } from "@/lib/models";
import { pluginIcon } from "@/lib/plugin-icons";
import { cn } from "@/lib/utils";
import { AttachmentChip } from "./AttachmentChip";

export interface ComposerProps {
  chat: Chat;
  onPatch: (patch: ChatPatch) => void;
  onRemoveAttachment: (index: number) => void;
  onPaste: (items: DataTransferItemList) => void;
  onSend: () => void;
  onStop: () => void;
  onClearHistory: () => void;
  onRetry: () => void;
  streaming: boolean;
  showRetry: boolean;
  presets: { id: string; name: string }[];
  library: ContextLibrary;
  models: ModelInfo[];
  plugins: { id: string; name: string; icon: string }[];
  onActivatePlugin: (id: string) => void;
}

const SELECT_TRIGGER_CLASS = "h-7 w-full text-caption";
const SELECT_CONTENT_POSITION = "popper";
const TOGGLE_ON = "on";
const TOGGLE_OFF = "off";
const NO_PRESET_VALUE = "none";

function pasteHasImages(items: DataTransferItemList) {
  return extractImageItems(items).length > 0;
}

type PromptTextareaProps = Pick<ComposerProps, "onPaste" | "onSend"> & {
  value: string;
  onChange: (value: string) => void;
};

const PROMPT_MAX_HEIGHT_PX = 160;

function usePromptAutosize(ref: RefObject<HTMLTextAreaElement | null>, value: string): void {
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${String(Math.min(el.scrollHeight, PROMPT_MAX_HEIGHT_PX))}px`;
  }, [ref]);

  useLayoutEffect(fit, [fit, value]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [ref, fit]);
}

function PromptTextarea(props: PromptTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  usePromptAutosize(ref, props.value);
  return (
    <Textarea
      ref={ref}
      value={props.value}
      onChange={(e) => {
        props.onChange(e.target.value);
      }}
      onPaste={(e) => {
        const items = e.clipboardData.items;
        if (pasteHasImages(items)) e.preventDefault();
        props.onPaste(items);
      }}
      onKeyDown={(e) => {
        const sendShortcutPressed = e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing;
        if (sendShortcutPressed) {
          e.preventDefault();
          props.onSend();
        }
      }}
      spellCheck={false}
      placeholder="Расшифровка появится здесь — или напиши вопрос сам"
      className="max-h-40 min-h-9 resize-none overflow-y-auto border-0 bg-transparent py-1.5 text-body shadow-none focus-visible:ring-0 dark:bg-transparent"
    />
  );
}

interface AttachmentListProps {
  attachments: Attachment[];
  onRemove: (index: number) => void;
}

function AttachmentList({ attachments, onRemove }: AttachmentListProps) {
  if (attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 px-3 pb-2">
      {attachments.map((att, i) => (
        <AttachmentChip
          key={att.preview}
          attachment={att}
          onRemove={() => {
            onRemove(i);
          }}
        />
      ))}
    </div>
  );
}

interface ToggleSelectProps {
  value: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
}

function ToggleSelect(props: ToggleSelectProps) {
  return (
    <Select
      value={props.value ? TOGGLE_ON : TOGGLE_OFF}
      disabled={props.disabled}
      onValueChange={(v) => {
        props.onChange(v === TOGGLE_ON);
      }}
    >
      <SelectTrigger className={SELECT_TRIGGER_CLASS}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position={SELECT_CONTENT_POSITION}>
        <SelectItem value={TOGGLE_ON}>Вкл</SelectItem>
        <SelectItem value={TOGGLE_OFF}>Выкл</SelectItem>
      </SelectContent>
    </Select>
  );
}

interface ModelSelectProps {
  value: string;
  models: ModelInfo[];
  onChange: (model: string) => void;
}

function ModelSelect(props: ModelSelectProps) {
  return (
    <Select value={props.value} onValueChange={props.onChange}>
      <SelectTrigger className={SELECT_TRIGGER_CLASS}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position={SELECT_CONTENT_POSITION}>
        {props.models.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {modelLabel(m)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface PresetSelectProps {
  presets: { id: string; name: string }[];
  presetId: string;
  onChange: (id: string) => void;
}

function PresetSelect({ presets, presetId, onChange }: PresetSelectProps) {
  const selectedValue =
    presetId !== "" && presets.some((p) => p.id === presetId) ? presetId : NO_PRESET_VALUE;
  return (
    <Select
      value={selectedValue}
      onValueChange={(v) => {
        onChange(v === NO_PRESET_VALUE ? "" : v);
      }}
    >
      <SelectTrigger className={SELECT_TRIGGER_CLASS}>
        <SelectValue placeholder="Препромпт" />
      </SelectTrigger>
      <SelectContent position={SELECT_CONTENT_POSITION}>
        <SelectItem value={NO_PRESET_VALUE}>Без препромпта</SelectItem>
        {presets.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name || "Без имени"}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ParamRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <Label className="w-[76px] shrink-0">{label}</Label>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

type RequestParamsProps = Pick<ComposerProps, "chat" | "onPatch" | "presets"> & {
  modelOptions: ModelInfo[];
  thinkingDisabled: boolean;
};

function RequestParamsPopover(props: RequestParamsProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-compact"
          title="Параметры запроса"
          aria-label="Параметры запроса"
        >
          <SlidersHorizontal />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-60 p-3">
        <div className="flex flex-col gap-1.5">
          <ParamRow label="Модель">
            <ModelSelect
              models={props.modelOptions}
              value={props.chat.model}
              onChange={(model) => {
                props.onPatch({ model });
              }}
            />
          </ParamRow>
          <ParamRow label="Thinking">
            <ToggleSelect
              value={props.chat.thinkingEnabled}
              disabled={props.thinkingDisabled}
              onChange={(thinkingEnabled) => {
                props.onPatch({ thinkingEnabled });
              }}
            />
          </ParamRow>
          <ParamRow label="Веб-поиск">
            <ToggleSelect
              value={props.chat.webSearch}
              onChange={(webSearch) => {
                props.onPatch({ webSearch });
              }}
            />
          </ParamRow>
          <ParamRow label="Препромпт">
            <PresetSelect
              presets={props.presets}
              presetId={props.chat.presetId}
              onChange={(presetId) => {
                props.onPatch({ presetId });
              }}
            />
          </ParamRow>
        </div>
      </PopoverContent>
    </Popover>
  );
}

type ComposerToolbarProps = RequestParamsProps &
  Pick<
    ComposerProps,
    | "onClearHistory"
    | "showRetry"
    | "onRetry"
    | "streaming"
    | "onStop"
    | "onSend"
    | "plugins"
    | "onActivatePlugin"
  > & {
    hasContext: boolean;
    onOpenContext: () => void;
  };

function ComposerToolbar(props: ComposerToolbarProps) {
  return (
    <div className="flex items-center gap-1 px-1.5 pb-1.5">
      <Button
        variant="ghost"
        size="icon-compact"
        disabled={props.streaming}
        onClick={props.onClearHistory}
        title="Очистить историю чата"
        aria-label="Очистить историю чата"
      >
        <Eraser />
      </Button>
      <Button
        variant="ghost"
        size="icon-compact"
        className="relative"
        onClick={props.onOpenContext}
        title="Контекст чата"
        aria-label="Контекст чата"
      >
        <NotebookText />
        {props.hasContext && (
          <span
            className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-primary"
            aria-hidden
          />
        )}
      </Button>
      <RequestParamsPopover
        chat={props.chat}
        onPatch={props.onPatch}
        modelOptions={props.modelOptions}
        thinkingDisabled={props.thinkingDisabled}
        presets={props.presets}
      />
      {props.plugins.map((p) => {
        const Icon = pluginIcon(p.icon);
        return (
          <Button
            key={p.id}
            variant="ghost"
            size="icon-compact"
            onClick={() => {
              props.onActivatePlugin(p.id);
            }}
            title={p.name}
            aria-label={p.name}
          >
            <Icon />
          </Button>
        );
      })}
      <div className="flex-1" />
      {props.showRetry && (
        <Button
          variant="ghost"
          size="icon-compact"
          onClick={props.onRetry}
          title="Повторить распознавание"
          aria-label="Повторить распознавание"
        >
          <RotateCcw />
        </Button>
      )}
      {props.streaming ? (
        <Button
          variant="destructive"
          size="icon-compact"
          onClick={props.onStop}
          title="Остановить ответ"
          aria-label="Остановить ответ"
        >
          <Square className="size-3.5 fill-current" />
        </Button>
      ) : (
        <Button
          size="icon-compact"
          onClick={props.onSend}
          title="Отправить (⏎)"
          aria-label="Отправить"
        >
          <ArrowUp />
        </Button>
      )}
    </div>
  );
}

interface ChatContextDialogProps {
  open: boolean;
  draft: string;
  library: ContextLibrary;
  selectedDocIds: string[];
  onDraftChange: (draft: string) => void;
  onToggleDoc: (id: string) => void;
  onCancel: () => void;
  onSave: () => void;
}

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
        "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-body transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        selected ? "bg-surface-active text-foreground" : "text-muted-foreground hover:bg-surface",
      )}
    >
      <Check className={`size-3.5 shrink-0 ${selected ? "" : "opacity-0"}`} />
      <span className="min-w-0 truncate">{doc.name}</span>
    </button>
  );
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
  if (library.docs.length === 0) {
    return (
      <p className="text-caption text-muted-foreground">
        Библиотека пуста — материалы добавляются в Настройках, вкладка «Контексты».
      </p>
    );
  }
  const selected = new Set(selectedDocIds);
  const groups = [
    { id: "", name: library.folders.length > 0 ? "Без папки" : "", docs: rootDocs(library) },
    ...library.folders.map((f) => ({ id: f.id, name: f.name, docs: docsInFolder(library, f.id) })),
  ].filter((g) => g.docs.length > 0);
  return (
    <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
      {groups.map((g) => (
        <div key={g.id} className="flex flex-col gap-0.5">
          {g.name !== "" && <SectionLabel className="px-2 pt-1">{g.name}</SectionLabel>}
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
  );
}

function ChatContextDialog(props: ChatContextDialogProps) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
    >
      <DialogContent className="max-w-[min(480px,95vw)] sm:max-w-[min(480px,95vw)]">
        <DialogHeader>
          <DialogTitle>Контекст чата</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Из библиотеки</SectionLabel>
          <LibraryPicker
            library={props.library}
            selectedDocIds={props.selectedDocIds}
            onToggleDoc={props.onToggleDoc}
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
            value={props.draft}
            onChange={(e) => {
              props.onDraftChange(e.target.value);
            }}
            placeholder="Вставь сюда справочные материалы"
            className="max-h-40 overflow-y-auto"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={props.onCancel}>
            Отмена
          </Button>
          <Button onClick={props.onSave}>Сохранить</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Composer(props: ComposerProps) {
  const { chat, onPatch } = props;
  const modelOptions = selectableModels(props.models, chat.model);
  const thinkingDisabled = thinkingLocked(modelOptions, chat.model);
  const [contextOpen, setContextOpen] = useState(false);
  const [contextDraft, setContextDraft] = useState("");
  const [selectedDraft, setSelectedDraft] = useState<string[]>([]);
  const openContextDialog = () => {
    setContextDraft(chat.context);
    setSelectedDraft(chat.libraryDocIds);
    setContextOpen(true);
  };
  const closeContextDialog = () => {
    setContextOpen(false);
  };
  const toggleSelectedDoc = (id: string) => {
    setSelectedDraft((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const saveContext = () => {
    onPatch({ context: contextDraft, libraryDocIds: selectedDraft });
    setContextOpen(false);
  };
  return (
    <section>
      <div className="rounded-xl bg-card/60 ring-1 ring-border transition-[box-shadow] ring-inset focus-within:ring-ring/50">
        <PromptTextarea
          value={chat.draft}
          onChange={(draft) => {
            onPatch({ draft });
          }}
          onPaste={props.onPaste}
          onSend={props.onSend}
        />
        <AttachmentList attachments={chat.draftAttachments} onRemove={props.onRemoveAttachment} />
        <ComposerToolbar
          chat={chat}
          onPatch={onPatch}
          onClearHistory={props.onClearHistory}
          hasContext={chat.context.trim() !== "" || chat.libraryDocIds.length > 0}
          onOpenContext={openContextDialog}
          showRetry={props.showRetry}
          onRetry={props.onRetry}
          modelOptions={modelOptions}
          thinkingDisabled={thinkingDisabled}
          presets={props.presets}
          streaming={props.streaming}
          onStop={props.onStop}
          onSend={props.onSend}
          plugins={props.plugins}
          onActivatePlugin={props.onActivatePlugin}
        />
      </div>
      <ChatContextDialog
        open={contextOpen}
        draft={contextDraft}
        library={props.library}
        selectedDocIds={selectedDraft}
        onDraftChange={setContextDraft}
        onToggleDoc={toggleSelectedDoc}
        onCancel={closeContextDialog}
        onSave={saveContext}
      />
    </section>
  );
}
