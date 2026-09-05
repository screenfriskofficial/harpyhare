import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { type Components } from "react-markdown";
import { ChatEmptyState } from "@/components/ChatEmptyState";
import { ChatHistory } from "@/components/ChatHistory";
import { FLOATING_CHIP_CLASS } from "@/components/IconCluster";
import { markdownComponents } from "@/components/markdown-config";
import { makePre } from "@/components/PreBlock";
import { StreamingAssistant } from "@/components/StreamingAssistant";
import { ThinkingIndicator } from "@/components/ThinkingIndicator";
import { useHotkeyScroll } from "@/hooks/useHotkeyScroll";
import { useStickToBottom } from "@/hooks/useStickToBottom";
import type { ChatMessage } from "@/lib/chats";
import { cn } from "@/lib/utils";

export interface AnswerPanelProps {
  messages: ChatMessage[];
  chatId: string;
  partial: string | null;
  streaming: boolean;
  /** Момент старта стрима; `undefined`, пока чат не стримит. */
  streamStartedAt: number | undefined;
  scrollStep: number;
  scrollModifier: string;
  recordCombo: string;
  screenshotCombo: string;
  onTogglePreview: (code: string) => void;
  onCopyMessage: (index: number) => void;
  onRemoveMessage: (index: number) => void;
  onResendMessage: (index: number) => void;
}

function JumpToBottomButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        FLOATING_CHIP_CLASS,
        "absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full px-2.5 py-1 text-caption text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 active:bg-surface-active",
      )}
    >
      {t("hud.jumpToBottom")}
    </button>
  );
}

export function AnswerPanel({
  messages,
  chatId,
  partial,
  streaming,
  streamStartedAt,
  scrollStep,
  scrollModifier,
  recordCombo,
  screenshotCombo,
  onTogglePreview,
  onCopyMessage,
  onRemoveMessage,
  onResendMessage,
}: AnswerPanelProps) {
  const { scrollRef, showJump, onScroll, resetToBottom, syncJump } = useStickToBottom();
  useHotkeyScroll(scrollRef, scrollStep, scrollModifier);

  // Синхронно до пейнта: иначе браузер показал бы кадр со старой позицией
  // и видимый «полёт сверху вниз» при переключении чата.
  useLayoutEffect(() => {
    resetToBottom();
  }, [chatId, resetToBottom]);

  const prevMessageCount = useRef(0);
  useEffect(() => {
    const grew = messages.length > prevMessageCount.current;
    prevMessageCount.current = messages.length;
    if (grew && messages[messages.length - 1]?.role === "user") resetToBottom();
    else syncJump();
  }, [messages, resetToBottom, syncJump]);

  useEffect(() => {
    syncJump();
  }, [partial, syncJump]);

  const components = useMemo<Components>(
    () => ({ ...markdownComponents, pre: makePre(onTogglePreview) }),
    [onTogglePreview],
  );

  const empty = messages.length === 0 && !partial;
  const streamHasText = partial !== null && partial !== "";

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="flex min-h-0 w-full flex-col gap-2.5 overflow-y-auto pr-1.5"
        >
          {empty ? (
            <ChatEmptyState recordCombo={recordCombo} screenshotCombo={screenshotCombo} />
          ) : (
            <>
              <ChatHistory
                messages={messages}
                streaming={streaming}
                components={components}
                onCopyMessage={onCopyMessage}
                onRemoveMessage={onRemoveMessage}
                onResendMessage={onResendMessage}
              />
              {streamHasText && (
                <StreamingAssistant key={chatId} text={partial} components={components} />
              )}
              {streaming && !streamHasText && <ThinkingIndicator startedAt={streamStartedAt} />}
            </>
          )}
        </div>
        {showJump && <JumpToBottomButton onClick={resetToBottom} />}
      </div>
    </section>
  );
}
