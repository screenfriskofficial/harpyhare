import { Copy, MessagesSquare, RotateCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useCopy } from "./copy";
import { copyText, HudMarkdown } from "./HudMarkdown";
import type { DemoMessage } from "./types";
import {
  AppIconButton,
  AppOrb,
  ComboChip,
  FLOATING_CHIP_CLASS,
  ICON_CLUSTER_BUTTON_CLASS,
  ICON_CLUSTER_BUTTON_SIZE_CLASS,
  ICON_CLUSTER_CLASS,
} from "./ui";

const SECOND_MS = 1000;
const NEAR_BOTTOM_PX = 40;
const RECORD_COMBO = "⌘R";
const SCREENSHOT_COMBO = "⌘⇧S";

/**
 * Показ/скрытие кластера мгновенные, без `transition-opacity` — как в
 * приложении, где анимация прозрачности в прозрачном окне оставляла артефакты.
 */
const MESSAGE_ACTIONS_REVEAL_CLASS =
  "pointer-events-none opacity-0 group-hover/msg:pointer-events-auto group-hover/msg:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100";

function useElapsedSeconds(startedAt: number) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const read = () => {
      setSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / SECOND_MS)));
    };
    read();
    const id = window.setInterval(read, SECOND_MS);
    return () => {
      clearInterval(id);
    };
  }, [startedAt]);
  return seconds;
}

function ThinkingIndicator({ startedAt }: { startedAt: number }) {
  const copy = useCopy().hud;
  const seconds = useElapsedSeconds(startedAt);
  return (
    <div className="flex items-baseline gap-2">
      <AppOrb state="solving" />
      <span className="app-shimmer text-app-body font-medium" aria-live="polite">
        {copy.thinking}
      </span>
      <span className="font-mono text-app-caption text-app-muted/60 tabular-nums" aria-hidden>
        {seconds}
        {copy.secondsSuffix}
      </span>
    </div>
  );
}

function MessageActions({
  onCopy,
  onResend,
  onRemove,
  className,
}: {
  onCopy: () => void;
  onResend: (() => void) | null;
  onRemove: () => void;
  className?: string;
}) {
  const copy = useCopy().hud.message;
  const buttonClass = cn(ICON_CLUSTER_BUTTON_SIZE_CLASS, ICON_CLUSTER_BUTTON_CLASS);
  return (
    <div className={cn(MESSAGE_ACTIONS_REVEAL_CLASS, "shrink-0", ICON_CLUSTER_CLASS, className)}>
      <AppIconButton title={copy.copy} className={buttonClass} onClick={onCopy}>
        <Copy />
      </AppIconButton>
      {onResend && (
        <AppIconButton title={copy.resend} className={buttonClass} onClick={onResend}>
          <RotateCw />
        </AppIconButton>
      )}
      <AppIconButton
        title={copy.remove}
        className={cn(buttonClass, "hover:text-app-destructive")}
        onClick={onRemove}
      >
        <Trash2 />
      </AppIconButton>
    </div>
  );
}

/**
 * У ответа ассистента жёлоба справа нет: кластер лежит поверх сообщения в
 * правом нижнем углу, где последняя строка абзаца почти всегда короткая.
 */
function MessageShell({
  align,
  actions,
  children,
}: {
  align: "start" | "end";
  actions: ReactNode;
  children: ReactNode;
}) {
  if (align === "end") {
    return (
      <div className="group/msg flex items-start justify-end gap-1">
        {actions}
        {children}
      </div>
    );
  }
  return (
    <div className="group/msg relative">
      {children}
      {actions}
    </div>
  );
}

function EmptyHint({ combo, text }: { combo: string; text: string }) {
  return (
    <span className="flex items-center gap-1.5 text-app-caption text-app-muted">
      <ComboChip combo={combo} />
      {text}
    </span>
  );
}

function EmptyState() {
  const copy = useCopy().hud.empty;
  return (
    <div className="grid h-full place-items-center">
      <div className="flex flex-col items-center gap-2.5 text-center">
        <span className="grid size-9 place-items-center rounded-lg bg-app-surface ring-1 ring-app-border ring-inset">
          <MessagesSquare className="size-4 text-app-muted" aria-hidden />
        </span>
        <span className="text-app-body text-app-muted">{copy.title}</span>
        <span className="flex flex-col items-center gap-1">
          <EmptyHint combo={RECORD_COMBO} text={copy.recordHint} />
          <EmptyHint combo={SCREENSHOT_COMBO} text={copy.screenshotHint} />
        </span>
      </div>
    </div>
  );
}

function useStickToBottom() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showJump, setShowJump] = useState(false);

  const syncJump = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    setShowJump(!near && el.scrollHeight > el.clientHeight);
  }, []);

  const resetToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setShowJump(false);
  }, []);

  return { scrollRef, showJump, syncJump, resetToBottom };
}

export function HudChat({
  chatId,
  messages,
  partial,
  streaming,
  streamStartedAt,
  onRemoveMessage,
  onResendMessage,
}: {
  chatId: string;
  messages: DemoMessage[];
  partial: string | null;
  streaming: boolean;
  streamStartedAt: number;
  onRemoveMessage: (index: number) => void;
  onResendMessage: (index: number) => void;
}) {
  const copy = useCopy().hud;
  const { scrollRef, showJump, syncJump, resetToBottom } = useStickToBottom();

  // Скролл-к-низу при переключении чата — синхронно до пейнта, как в приложении.
  useLayoutEffect(() => {
    resetToBottom();
  }, [chatId, resetToBottom]);

  // Автоскролла во время стрима нет намеренно: вниз прокручивает только
  // отправка своего сообщения; рост ответа лишь обновляет кнопку «↓ Вниз».
  const prevCount = useRef(0);
  useEffect(() => {
    const grew = messages.length > prevCount.current;
    prevCount.current = messages.length;
    if (grew && messages[messages.length - 1]?.role === "user") resetToBottom();
    else syncJump();
  }, [messages, resetToBottom, syncJump]);

  useEffect(() => {
    syncJump();
  }, [partial, syncJump]);

  const empty = messages.length === 0 && partial === null && !streaming;
  const streamHasText = partial !== null && partial !== "";

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={syncJump}
          className="app-scroll flex min-h-0 w-full flex-col gap-2.5 overflow-y-auto pr-1.5"
        >
          {empty ? (
            <EmptyState />
          ) : (
            <>
              {messages.map((message, index) => {
                const isUser = message.role === "user";
                const actions = (
                  <MessageActions
                    onCopy={() => void copyText(message.text)}
                    onResend={
                      isUser && !streaming
                        ? () => {
                            onResendMessage(index);
                          }
                        : null
                    }
                    onRemove={() => {
                      onRemoveMessage(index);
                    }}
                    className={isUser ? undefined : "absolute right-0 bottom-0"}
                  />
                );
                return (
                  <MessageShell key={index} align={isUser ? "end" : "start"} actions={actions}>
                    {isUser ? (
                      <div className="max-w-[85%] rounded-lg bg-app-surface-active px-3 py-1.5 text-app-chat break-words whitespace-pre-wrap text-app-fg ring-1 ring-app-border ring-inset">
                        {message.text}
                      </div>
                    ) : (
                      <HudMarkdown text={message.text} />
                    )}
                  </MessageShell>
                );
              })}
              {streamHasText && <HudMarkdown text={partial} />}
              {streaming && !streamHasText && <ThinkingIndicator startedAt={streamStartedAt} />}
            </>
          )}
        </div>
        {showJump && (
          <button
            type="button"
            onClick={resetToBottom}
            className={cn(
              FLOATING_CHIP_CLASS,
              "absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full px-2.5 py-1 text-app-caption text-app-muted transition-colors hover:text-app-fg",
            )}
          >
            {copy.jumpToBottom}
          </button>
        )}
      </div>
    </section>
  );
}
