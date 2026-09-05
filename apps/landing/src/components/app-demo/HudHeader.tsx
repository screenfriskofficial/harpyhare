import {
  Copy,
  CopyPlus,
  Cpu,
  Eye,
  EyeOff,
  Keyboard,
  Menu,
  MessagesSquare,
  Minus,
  NotebookText,
  Plus,
  ScrollText,
  Square,
  X,
} from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import type { OrbState } from "thinking-orbs";
import { cn } from "@/lib/cn";
import { useCopy } from "./copy";
import { copyText } from "./HudMarkdown";
import {
  AppIconButton,
  AppOrb,
  ComboChip,
  DOCK_BUTTON_CLASS,
  ICON_CLUSTER_CLASS,
  ORB_STATE_IDLE,
  SectionLabel,
} from "./ui";
import type { DemoRun } from "./useDemoRun";

const CHAT_LIMIT = 6;
const CONTEXT_CHARS_PER_PERCENT = 260;
const CONTEXT_MAX_PERCENT = 96;
const CONTEXT_WARN_PERCENT = 80;
const CONTEXT_GAUGE_MIN_FILL_PERCENT = 3;

export type HudMode = "chat" | "notes";

function recorderOrb(run: DemoRun): OrbState {
  if (run.recorder === "recording") return "listening";
  if (run.recorder === "transcribing") return "working";
  return ORB_STATE_IDLE;
}

function ContextUsageGauge({ percent }: { percent: number }) {
  const title = useCopy().hud.contextUsage;
  return (
    <div className="flex shrink-0 items-center gap-1.5 px-1" title={title}>
      <span className="h-1 w-10 overflow-hidden rounded-full bg-app-surface-active">
        <span
          className={cn(
            "block h-full rounded-full transition-[width] duration-300",
            percent >= CONTEXT_WARN_PERCENT ? "bg-app-destructive" : "bg-app-muted/60",
          )}
          style={{ width: `${Math.max(CONTEXT_GAUGE_MIN_FILL_PERCENT, percent)}%` }}
        />
      </span>
      <span className="text-app-hint text-app-muted tabular-nums">{percent}%</span>
    </div>
  );
}

function ChatTabs({ run }: { run: DemoRun }) {
  const copy = useCopy().hud.tabs;
  const atLimit = run.chats.length >= CHAT_LIMIT;
  return (
    <div className="flex min-w-0 shrink items-center gap-1">
      <nav
        aria-label={copy.nav}
        className="app-no-scrollbar flex min-w-0 shrink items-center gap-1 overflow-x-auto"
      >
        {run.chats.map((chat, index) => {
          const isActive = chat.id === run.activeId;
          const closeOnClick = isActive && run.chats.length > 1;
          const streaming = run.stream?.chatId === chat.id;
          const name = chat.title === "" ? `${copy.chat} ${index + 1}` : chat.title;
          return (
            <button
              key={chat.id}
              type="button"
              title={closeOnClick ? copy.closeChat : name}
              aria-label={closeOnClick ? copy.closeChat : name}
              onClick={() => {
                if (closeOnClick) run.closeChat(chat.id);
                else run.selectChat(chat.id);
              }}
              className={cn(
                "group relative grid size-7 shrink-0 place-items-center rounded-md font-mono text-app-caption transition-colors outline-none focus-visible:ring-2 focus-visible:ring-app-ring/60",
                isActive
                  ? "bg-app-surface-active text-app-fg ring-1 ring-app-border ring-inset"
                  : "text-app-muted hover:bg-app-surface hover:text-app-fg active:bg-app-surface-active",
              )}
            >
              <span className={cn("tabular-nums", closeOnClick && "group-hover:hidden")}>
                {index + 1}
              </span>
              {closeOnClick && <X className="hidden size-4 group-hover:block" />}
              {(streaming || run.unread[chat.id]) && (
                <span
                  className={cn(
                    "absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-app-primary",
                    streaming && "animate-pulse",
                  )}
                  aria-hidden
                />
              )}
            </button>
          );
        })}
      </nav>
      <AppIconButton title={copy.newChat} disabled={atLimit} onClick={run.newChat}>
        <Plus />
      </AppIconButton>
      <AppIconButton title={copy.duplicate} disabled={atLimit} onClick={run.duplicateChat}>
        <CopyPlus />
      </AppIconButton>
    </div>
  );
}

function ModeSwitch({ mode, onSelect }: { mode: HudMode; onSelect: (mode: HudMode) => void }) {
  const copy = useCopy().hud.modes;
  const entries: { id: HudMode; icon: ReactNode; label: string }[] = [
    { id: "chat", icon: <MessagesSquare />, label: copy.chat.label },
    { id: "notes", icon: <NotebookText />, label: copy.notes.label },
  ];
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {entries.map((entry) => {
        const active = entry.id === mode;
        return (
          <AppIconButton
            key={entry.id}
            title={`${copy.modePrefix}${entry.label}`}
            aria-pressed={active}
            className={cn(
              DOCK_BUTTON_CLASS,
              active && "bg-app-surface-active text-app-fg hover:text-app-fg",
            )}
            onClick={() => {
              onSelect(entry.id);
            }}
          >
            {entry.icon}
          </AppIconButton>
        );
      })}
    </span>
  );
}

function HotkeysPopover() {
  const copy = useCopy().hud;
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex shrink-0">
      <AppIconButton
        title={copy.dock.hotkeys}
        aria-expanded={open}
        className={DOCK_BUTTON_CLASS}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        <Keyboard />
      </AppIconButton>
      {open && (
        <>
          <button
            type="button"
            aria-label={copy.dock.hotkeys}
            className="fixed inset-0 z-30 cursor-default"
            onClick={() => {
              setOpen(false);
            }}
          />
          <div className="app-scroll absolute top-0 right-full z-40 mr-2 max-h-72 w-72 overflow-y-auto rounded-lg bg-app-popover p-3 shadow-app-pop ring-1 ring-app-border ring-inset">
            <div className="grid grid-cols-[max-content_1fr] items-center gap-x-2.5 gap-y-1">
              {copy.hotkeyGroups.map((group, index) => (
                <Fragment key={group.title}>
                  <SectionLabel className={cn("col-span-2", index > 0 && "mt-2.5")}>
                    {group.title}
                  </SectionLabel>
                  {group.rows.map((row) => (
                    <Fragment key={row.label}>
                      <ComboChip combo={row.combo} className="w-full" />
                      <span className="min-w-0 truncate text-app-caption text-app-muted">
                        {row.label}
                      </span>
                    </Fragment>
                  ))}
                </Fragment>
              ))}
            </div>
          </div>
        </>
      )}
    </span>
  );
}

interface DockItem {
  id: string;
  label: string;
  icon?: ReactNode;
  element?: ReactNode;
  iconClass?: string;
  disabled?: boolean;
  onClick?: () => void;
}

/** Док действий: пилюля с переключателем режимов и кнопкой меню, список раскрывается вниз. */
function ToolbarDock({ items, leading }: { items: DockItem[]; leading: ReactNode }) {
  const copy = useCopy().hud.dock;
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <span className={ICON_CLUSTER_CLASS}>
        {leading}
        <span className="mx-0.5 h-4 w-px shrink-0 bg-app-border" aria-hidden />
        <AppIconButton
          title={open ? copy.close : copy.open}
          aria-expanded={open}
          className={DOCK_BUTTON_CLASS}
          onClick={() => {
            setOpen((o) => !o);
          }}
        >
          <Menu />
        </AppIconButton>
      </span>
      {open && (
        <>
          <button
            type="button"
            aria-label={copy.close}
            className="fixed inset-0 z-20 cursor-default"
            onClick={() => {
              setOpen(false);
            }}
          />
          <div className="absolute top-full right-0 z-30 mt-1.5 flex flex-col items-center gap-0.5 rounded-xl bg-app-bg p-0.5 shadow-app-pop ring-1 ring-app-border ring-inset">
            {items.map((item) => (
              <span key={item.id} className="relative inline-flex shrink-0">
                {item.element ?? (
                  <AppIconButton
                    title={item.label}
                    className={cn(DOCK_BUTTON_CLASS, item.iconClass)}
                    disabled={item.disabled}
                    onClick={() => {
                      item.onClick?.();
                      setOpen(false);
                    }}
                  >
                    {item.icon}
                  </AppIconButton>
                )}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function HudHeader({
  run,
  mode,
  screenShareVisible,
  onSelectMode,
  onToggleScreenShare,
  onOpenTeleprompter,
  onOpenModels,
  onCollapse,
  onStop,
}: {
  run: DemoRun;
  mode: HudMode;
  screenShareVisible: boolean;
  onSelectMode: (mode: HudMode) => void;
  onToggleScreenShare: () => void;
  onOpenTeleprompter: () => void;
  onOpenModels: () => void;
  onCollapse: () => void;
  onStop: () => void;
}) {
  const copy = useCopy().hud.dock;
  const chars =
    run.active.messages.reduce((total, message) => total + message.text.length, 0) +
    (run.stream?.chatId === run.activeId ? run.stream.partial.length : 0);
  const percent = Math.min(
    CONTEXT_MAX_PERCENT,
    Math.round(chars / CONTEXT_CHARS_PER_PERCENT) + (chars > 0 ? 4 : 0),
  );
  const lastAnswer = [...run.active.messages].reverse().find((m) => m.role === "assistant");
  const activeStreaming = run.stream?.chatId === run.activeId;
  const canCopy = lastAnswer !== undefined && !activeStreaming;
  const canTeleprompt = lastAnswer !== undefined || activeStreaming;

  const items: DockItem[] = [
    {
      id: "copy",
      label: copy.copyLast,
      icon: <Copy />,
      disabled: !canCopy,
      onClick: () => {
        if (lastAnswer) void copyText(lastAnswer.text);
      },
    },
    {
      id: "teleprompter",
      label: copy.teleprompter,
      icon: <ScrollText />,
      disabled: !canTeleprompt,
      onClick: onOpenTeleprompter,
    },
    { id: "models", label: copy.models, icon: <Cpu />, onClick: onOpenModels },
    {
      id: "screen-share",
      label: screenShareVisible ? copy.screenShareVisible : copy.screenShareHidden,
      icon: screenShareVisible ? <Eye /> : <EyeOff />,
      iconClass: screenShareVisible ? "text-app-primary hover:text-app-primary/85" : undefined,
      onClick: onToggleScreenShare,
    },
    { id: "hotkeys", label: copy.hotkeys, element: <HotkeysPopover /> },
    { id: "mini", label: copy.mini, icon: <Minus />, onClick: onCollapse },
    { id: "stop", label: copy.stop, icon: <Square />, onClick: onStop },
  ];

  return (
    <header className="flex min-h-7 items-center gap-2">
      <AppOrb state={recorderOrb(run)} />
      <ChatTabs run={run} />
      <span className="min-w-0 flex-1" />
      <div className="flex shrink-0 items-center gap-1.5">
        {percent > 0 && <ContextUsageGauge percent={percent} />}
        <ToolbarDock items={items} leading={<ModeSwitch mode={mode} onSelect={onSelectMode} />} />
      </div>
    </header>
  );
}
