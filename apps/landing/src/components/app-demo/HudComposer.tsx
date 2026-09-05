import {
  ArrowUp,
  Check,
  ChevronDown,
  Crop,
  Eraser,
  Lock,
  NotebookText,
  SlidersHorizontal,
  Square,
  X,
} from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { QuickActionId } from "@/i18n/demo-types";
import { cn } from "@/lib/cn";
import { useCopy } from "./copy";
import type { DemoChat, DemoChatParams } from "./types";
import { AppIconButton, AppSwitch, SectionLabel } from "./ui";

const PROMPT_MAX_HEIGHT_PX = 160;
const SELECT_TRIGGER_CLASS =
  "flex h-7 w-full min-w-0 items-center justify-between gap-1.5 rounded-md border border-app-border bg-app-surface/40 px-2 text-app-caption text-app-fg transition-colors outline-none hover:bg-app-surface focus-visible:ring-2 focus-visible:ring-app-ring/60";
const POPOVER_CLASS =
  "rounded-lg bg-app-popover p-3 text-app-fg shadow-app-pop ring-1 ring-app-border ring-inset";

interface SelectOption {
  id: string;
  label: string;
  group?: string;
  locked?: boolean;
}

/** Выпадающий список в духе Radix Select: группы с подписью, запертые вендоры без ключа. */
function AppSelect({
  value,
  options,
  ariaLabel,
  placeholder,
  lockedHint,
  onChange,
}: {
  value: string;
  options: SelectOption[];
  ariaLabel: string;
  placeholder?: string;
  lockedHint: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.id === value);
  const groups = [...new Set(options.map((option) => option.group))];
  return (
    <div className="relative min-w-0 flex-1">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
        }}
        className={SELECT_TRIGGER_CLASS}
      >
        <span className={cn("min-w-0 truncate", !current && "text-app-muted/60")}>
          {current?.label ?? placeholder}
        </span>
        <ChevronDown className="size-3.5 shrink-0 opacity-50" />
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label={ariaLabel}
            className="fixed inset-0 z-30 cursor-default"
            onClick={() => {
              setOpen(false);
            }}
          />
          <div
            role="listbox"
            className="absolute top-full left-0 z-40 mt-1 w-full min-w-40 rounded-md bg-app-popover p-1 shadow-app-pop ring-1 ring-app-border ring-inset"
          >
            {groups.map((group) => {
              const items = options.filter((option) => option.group === group);
              const locked = items.every((option) => option.locked);
              return (
                <div key={group ?? ""}>
                  {group !== undefined && groups.length > 1 && (
                    <div className="px-2 py-1 text-app-hint font-medium text-app-muted">
                      {group}
                      {locked && <span className="ml-1.5 font-normal">{lockedHint}</span>}
                    </div>
                  )}
                  {items.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      role="option"
                      aria-selected={option.id === value}
                      disabled={option.locked}
                      onClick={() => {
                        onChange(option.id);
                        setOpen(false);
                      }}
                      className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-app-caption text-app-fg transition-colors hover:bg-app-surface-active disabled:opacity-50"
                    >
                      {option.locked && <Lock className="size-3" aria-hidden />}
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                      {option.id === value && <Check className="size-3.5 shrink-0" />}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function ParamRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-7 items-center gap-2">
      <span className="w-20 shrink-0 text-app-caption font-medium text-app-fg">{label}</span>
      <div className="flex min-w-0 flex-1 items-center justify-end">{children}</div>
    </div>
  );
}

function RequestParamsPopover({
  chat,
  onPatch,
}: {
  chat: DemoChat;
  onPatch: (patch: Partial<DemoChatParams>) => void;
}) {
  const copy = useCopy().hud;
  const [open, setOpen] = useState(false);
  const modelOptions: SelectOption[] = copy.models.groups.flatMap((group) =>
    group.models.map((model) => ({
      id: model.id,
      label: model.label,
      group: group.label,
      locked: group.locked,
    })),
  );
  const presetOptions: SelectOption[] = [
    { id: "", label: copy.composer.noPreset },
    ...copy.composer.presets.map((name, index) => ({ id: String(index + 1), label: name })),
  ];
  // Thinking нельзя включить у модели без адаптивного режима — как у Haiku в приложении.
  const thinkingLocked = chat.model.includes("haiku");
  return (
    <div className="relative">
      <AppIconButton
        title={copy.composer.requestParams}
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
        }}
        className={cn(open && "bg-app-surface text-app-fg")}
      >
        <SlidersHorizontal />
      </AppIconButton>
      {open && (
        <>
          <button
            type="button"
            aria-label={copy.composer.requestParams}
            className="fixed inset-0 z-20 cursor-default"
            onClick={() => {
              setOpen(false);
            }}
          />
          <div className={cn(POPOVER_CLASS, "absolute bottom-full left-0 z-30 mb-1.5 w-64")}>
            <div className="flex flex-col gap-1">
              <ParamRow label={copy.composer.model}>
                <AppSelect
                  value={chat.model}
                  options={modelOptions}
                  ariaLabel={copy.composer.model}
                  lockedHint={copy.composer.missingKey}
                  onChange={(model) => {
                    onPatch({ model, thinking: model.includes("haiku") ? false : chat.thinking });
                  }}
                />
              </ParamRow>
              <ParamRow label={copy.composer.preset}>
                <AppSelect
                  value={chat.presetId}
                  options={presetOptions}
                  ariaLabel={copy.composer.preset}
                  placeholder={copy.composer.preset}
                  lockedHint={copy.composer.missingKey}
                  onChange={(presetId) => {
                    onPatch({ presetId });
                  }}
                />
              </ParamRow>
              <ParamRow label={copy.composer.thinking}>
                <AppSwitch
                  checked={chat.thinking}
                  disabled={thinkingLocked}
                  ariaLabel={copy.composer.thinking}
                  onChange={(thinking) => {
                    onPatch({ thinking });
                  }}
                />
              </ParamRow>
              <ParamRow label={copy.composer.webSearch}>
                <AppSwitch
                  checked={chat.webSearch}
                  ariaLabel={copy.composer.webSearch}
                  onChange={(webSearch) => {
                    onPatch({ webSearch });
                  }}
                />
              </ParamRow>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Диалог «Контекст чата»: материалы библиотеки и свой текст, как в приложении. */
function ChatContextDialog({
  chat,
  onPatch,
  onClose,
}: {
  chat: DemoChat;
  onPatch: (patch: Partial<DemoChatParams>) => void;
  onClose: () => void;
}) {
  const copy = useCopy();
  const dialog = copy.hud.context;
  const docs = copy.launcher.contexts.docs;
  const folders = copy.launcher.contexts.folders;
  const [selected, setSelected] = useState(chat.libraryDocIds);
  const [draft, setDraft] = useState(chat.context);
  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center rounded-[inherit] bg-black/55 p-4"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label={dialog.title}
        className="relative flex max-h-full w-[min(480px,100%)] flex-col gap-3.5 overflow-hidden rounded-xl border border-app-border bg-app-popover p-5 shadow-app-modal"
      >
        <h3 className="text-app-title leading-none font-semibold tracking-tight">{dialog.title}</h3>
        <button
          type="button"
          aria-label={dialog.cancel}
          onClick={onClose}
          className="absolute top-4 right-4 rounded-sm text-app-muted transition-colors hover:text-app-fg [&_svg]:size-4"
        >
          <X />
        </button>
        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto">
          <div className="flex flex-col gap-1.5">
            <SectionLabel>
              {dialog.fromLibrary}
              {selected.length > 0 && (
                <span className="ml-1.5 text-app-muted tabular-nums">
                  {dialog.selectedCount} {selected.length}
                </span>
              )}
            </SectionLabel>
            <div className="app-scroll flex max-h-[min(12rem,32dvh)] flex-col gap-1 overflow-y-auto">
              {folders.map((folder) => (
                <div key={folder} className="flex flex-col gap-0.5">
                  <SectionLabel className="truncate px-2 pt-1">{folder}</SectionLabel>
                  {docs
                    .filter((doc) => doc.folder === folder)
                    .map((doc) => {
                      const isSelected = selected.includes(doc.id);
                      return (
                        <button
                          key={doc.id}
                          type="button"
                          onClick={() => {
                            toggle(doc.id);
                          }}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-app-body transition-colors outline-none",
                            isSelected
                              ? "bg-app-surface-active text-app-fg"
                              : "text-app-muted hover:bg-app-surface",
                          )}
                        >
                          <Check className={cn("size-3.5 shrink-0", !isSelected && "opacity-0")} />
                          <span className="min-w-0 truncate">{doc.name}</span>
                        </button>
                      );
                    })}
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <SectionLabel>{dialog.ownText}</SectionLabel>
            <p className="text-app-caption text-app-muted">{dialog.ownTextHint}</p>
            <textarea
              rows={5}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
              }}
              placeholder={dialog.ownTextPlaceholder}
              className="app-scroll max-h-40 w-full resize-none rounded-md border border-app-border bg-app-surface/40 px-2.5 py-1.5 text-app-body text-app-fg outline-none placeholder:text-app-muted/60 focus-visible:ring-2 focus-visible:ring-app-ring/40"
            />
          </div>
        </div>
        <div className="flex shrink-0 justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center rounded-md px-3.5 text-app-body font-medium text-app-muted transition-colors hover:bg-app-surface hover:text-app-fg"
          >
            {dialog.cancel}
          </button>
          <button
            type="button"
            onClick={() => {
              onPatch({ context: draft, libraryDocIds: selected });
              onClose();
            }}
            className="inline-flex h-8 items-center rounded-md bg-app-primary px-3.5 text-app-body font-medium text-app-primary-fg shadow-app-btn transition-colors hover:bg-app-primary/90"
          >
            {dialog.save}
          </button>
        </div>
      </div>
    </div>
  );
}

function PromptTextarea({
  value,
  onChange,
  onSend,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
}) {
  const copy = useCopy().hud.composer;
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, PROMPT_MAX_HEIGHT_PX)}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      spellCheck={false}
      placeholder={copy.placeholder}
      onChange={(e) => {
        onChange(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          onSend();
        }
      }}
      style={{ maxHeight: PROMPT_MAX_HEIGHT_PX }}
      className="app-scroll block min-h-9 w-full resize-none overflow-y-auto bg-transparent px-2.5 py-1.5 text-app-body text-app-fg outline-none placeholder:text-app-muted/60"
    />
  );
}

/** Полоса быстрых действий над карточкой композера; подпись — название, в чат уходит промпт. */
function QuickActionsBar({
  disabled,
  onRun,
}: {
  disabled: boolean;
  onRun: (id: QuickActionId) => void;
}) {
  const copy = useCopy().hud;
  return (
    <div
      role="group"
      onMouseDown={(e) => {
        e.preventDefault();
      }}
      className="app-no-scrollbar mb-1.5 flex min-w-0 items-center gap-1 overflow-x-auto"
    >
      {copy.quickActions.map((action, index) => (
        <button
          key={action.id}
          type="button"
          title={action.title}
          disabled={disabled}
          onClick={() => {
            onRun(action.id);
          }}
          className="inline-flex h-6.5 shrink-0 items-center gap-1.5 rounded-md bg-app-surface px-2 text-app-caption font-medium whitespace-nowrap text-app-fg/85 ring-1 ring-app-border transition-colors ring-inset hover:bg-app-surface-active active:bg-app-surface disabled:pointer-events-none disabled:opacity-50"
        >
          {action.title}
          <span className="font-mono text-app-hint text-app-muted/80 tabular-nums">
            {copy.quickActionModifier}
            {index + 1}
          </span>
        </button>
      ))}
    </div>
  );
}

export function HudComposer({
  chat,
  streaming,
  onDraftChange,
  onPatch,
  onSend,
  onStop,
  onClearHistory,
  onQuickAction,
  onScreenshot,
}: {
  chat: DemoChat;
  streaming: boolean;
  onDraftChange: (value: string) => void;
  onPatch: (patch: Partial<DemoChatParams>) => void;
  onSend: () => void;
  onStop: () => void;
  onClearHistory: () => void;
  onQuickAction: (id: QuickActionId) => void;
  onScreenshot: () => void;
}) {
  const copy = useCopy().hud.composer;
  const [contextOpen, setContextOpen] = useState(false);
  const hasContext = chat.context.trim() !== "" || chat.libraryDocIds.length > 0;

  return (
    <section>
      <QuickActionsBar disabled={streaming} onRun={onQuickAction} />
      <div className="rounded-xl bg-app-card/70 shadow-app-raise ring-1 ring-app-border transition-[box-shadow] ring-inset focus-within:ring-app-ring/60">
        <PromptTextarea value={chat.draft} onChange={onDraftChange} onSend={onSend} />
        <div className="flex items-center gap-1 px-1.5 pb-1.5">
          <AppIconButton title={copy.clearHistory} disabled={streaming} onClick={onClearHistory}>
            <Eraser />
          </AppIconButton>
          <AppIconButton
            title={copy.chatContext}
            className="relative"
            onClick={() => {
              setContextOpen(true);
            }}
          >
            <NotebookText />
            {hasContext && (
              <span
                className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-app-primary"
                aria-hidden
              />
            )}
          </AppIconButton>
          <AppIconButton title={copy.screenshot} onClick={onScreenshot}>
            <Crop />
          </AppIconButton>
          <RequestParamsPopover chat={chat} onPatch={onPatch} />
          <div className="flex-1" />
          {streaming ? (
            <button
              type="button"
              title={copy.stopAnswer}
              aria-label={copy.stopAnswer}
              onClick={onStop}
              className="grid size-7 shrink-0 place-items-center rounded-md bg-app-destructive/75 text-app-primary-fg shadow-app-btn transition-colors hover:bg-app-destructive/65"
            >
              <Square className="size-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              title={`${copy.send} ${copy.sendShortcut}`}
              aria-label={copy.send}
              onClick={onSend}
              className="grid size-7 shrink-0 place-items-center rounded-md bg-app-primary text-app-primary-fg shadow-app-btn transition-colors hover:bg-app-primary/90 active:bg-app-primary/80"
            >
              <ArrowUp className="size-4" />
            </button>
          )}
        </div>
      </div>
      {contextOpen && (
        <ChatContextDialog
          chat={chat}
          onPatch={onPatch}
          onClose={() => {
            setContextOpen(false);
          }}
        />
      )}
    </section>
  );
}
