import { CopyPlus, Plus, X } from "lucide-react";
import { memo, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/IconButton";
import { ShortcutTooltip } from "@/components/ShortcutTooltip";
import { CHAT_LIMIT, type Chat } from "@/lib/chats";
import { formatCombo } from "@/lib/hotkeys";
import { cn } from "@/lib/utils";

export interface ChatTabsProps {
  chats: Chat[];
  activeId: string;
  streaming: Record<string, boolean>;
  unread: Record<string, boolean>;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onNew: () => void;
  onDuplicate: () => void;
  duplicateCombo: string;
}

/** `memo`: шапка не перерисовывается на каждый кадр стрима — App даёт стабильные колбэки. */
export const ChatTabs = memo(function ChatTabs({
  chats,
  activeId,
  streaming,
  unread,
  onSelect,
  onRemove,
  onNew,
  onDuplicate,
  duplicateCombo,
}: ChatTabsProps) {
  const { t } = useTranslation();
  const atLimit = chats.length >= CHAT_LIMIT;
  const activeRef = useRef<HTMLButtonElement>(null);
  const newChatTitle = t("chats.new");
  const duplicateTitle = t("chats.duplicate");

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId]);

  return (
    <div className="flex min-w-0 shrink items-center gap-1">
      <nav
        aria-label={t("chats.tabs")}
        className="no-scrollbar flex min-w-0 shrink items-center gap-1 overflow-x-auto"
      >
        {chats.map((c, i) => {
          const isActive = c.id === activeId;
          return (
            <ChatTab
              key={c.id}
              ref={isActive ? activeRef : undefined}
              number={i + 1}
              title={c.title}
              isActive={isActive}
              isStreaming={!!streaming[c.id]}
              hasUnread={!!unread[c.id]}
              closable={chats.length > 1}
              onSelect={() => {
                onSelect(c.id);
              }}
              onRemove={() => {
                onRemove(c.id);
              }}
            />
          );
        })}
      </nav>
      <ShortcutTooltip label={newChatTitle}>
        <IconButton title="" aria-label={newChatTitle} onClick={onNew} disabled={atLimit}>
          <Plus />
        </IconButton>
      </ShortcutTooltip>
      <ShortcutTooltip label={duplicateTitle} shortcut={formatCombo(duplicateCombo)}>
        <IconButton title="" aria-label={duplicateTitle} onClick={onDuplicate} disabled={atLimit}>
          <CopyPlus />
        </IconButton>
      </ShortcutTooltip>
    </div>
  );
});

interface ChatTabProps {
  ref?: React.Ref<HTMLButtonElement>;
  number: number;
  title: string;
  isActive: boolean;
  isStreaming: boolean;
  hasUnread: boolean;
  closable: boolean;
  onSelect: () => void;
  onRemove: () => void;
}

function ChatTab({
  ref,
  number,
  title,
  isActive,
  isStreaming,
  hasUnread,
  closable,
  onSelect,
  onRemove,
}: ChatTabProps) {
  const { t } = useTranslation();
  const closeOnClick = isActive && closable;
  const name = title === "" ? t("chats.numbered", { number }) : title;
  const label = closeOnClick ? t("chats.closeTab", { name }) : name;
  return (
    <ShortcutTooltip label={label}>
      <button
        ref={ref}
        type="button"
        onClick={closeOnClick ? onRemove : onSelect}
        aria-label={label}
        className={cn(
          "group relative grid size-7 shrink-0 place-items-center rounded-md font-mono text-caption transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
          isActive
            ? "bg-surface-active text-foreground ring-1 ring-border ring-inset"
            : "text-muted-foreground hover:bg-surface hover:text-foreground active:bg-surface-active",
        )}
      >
        <span
          className={cn(
            "tabular-nums",
            closeOnClick && "group-hover:hidden group-focus-visible:hidden",
          )}
        >
          {number}
        </span>
        {closeOnClick && (
          <X className="hidden size-4 group-hover:block group-focus-visible:block" />
        )}
        {(isStreaming || hasUnread) && (
          <span
            className={cn(
              "absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-primary",
              isStreaming && "animate-pulse",
            )}
            aria-hidden
          />
        )}
      </button>
    </ShortcutTooltip>
  );
}
