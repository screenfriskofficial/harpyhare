import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { ChatEmptyState } from "@/components/ChatEmptyState";
import { ChatHistory } from "@/components/ChatHistory";
import { FLOATING_CHIP_CLASS } from "@/components/IconCluster";
import { StreamingAssistant } from "@/components/StreamingAssistant";
import { ThinkingIndicator } from "@/components/ThinkingIndicator";
import { useAnswerMarkdownComponents } from "@/hooks/useAnswerMarkdownComponents";
import { useHotkeyScroll } from "@/hooks/useHotkeyScroll";
import { useLatestRef } from "@/hooks/useLatestRef";
import { useStickToBottom, type ScrollPosition } from "@/hooks/useStickToBottom";
import { useWheelPassThrough } from "@/hooks/useWheelPassThrough";
import type { ChatMessage } from "@/lib/chats";
import type { PreviewContent } from "@/lib/html-blocks";
import { cn } from "@/lib/utils";

/**
 * Where the chat stood when its panel last unmounted (mini mode, notes). It
 * lives above the panel because the panel itself is gone by then, and it is
 * spent by the first mount that follows: the same chat returns to its place,
 * any other chat still opens at the bottom.
 */
export interface ChatScrollMemory extends ScrollPosition {
  chatId: string;
}

export interface AnswerPanelProps {
  messages: ChatMessage[];
  chatId: string;
  scrollMemory: RefObject<ChatScrollMemory | null>;
  /**
   * How far the open composer reaches over the ledger's bottom. The ledger pads
   * by it, so the last lines stay reachable, and clips that band away, so no
   * text is painted under the composer — its card is translucent and the
   * quick actions have gaps.
   */
  bottomInset: number;
  partial: string | null;
  streaming: boolean;
  /** Момент старта стрима; `undefined`, пока чат не стримит. */
  streamStartedAt: number | undefined;
  /** What the wait is for when it is not the model itself — a pipeline's name; `undefined` otherwise. */
  streamLabel?: string;
  scrollStep: number;
  scrollModifier: string;
  recordCombo: string;
  screenshotCombo: string;
  onTogglePreview: (content: PreviewContent) => void;
  onCopyMessage: (index: number) => void;
  onRemoveMessage: (index: number) => void;
  onResendMessage: (index: number) => void;
}

/** The chip floats this far above whatever covers the ledger's bottom edge. */
const JUMP_BUTTON_OFFSET_PX = 8;

function JumpToBottomButton({ inset, onClick }: { inset: number; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ bottom: inset + JUMP_BUTTON_OFFSET_PX }}
      className={cn(
        FLOATING_CHIP_CLASS,
        "absolute left-1/2 -translate-x-1/2 rounded-full px-2.5 py-1 text-caption text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 active:bg-surface-active",
      )}
    >
      {t("hud.jumpToBottom")}
    </button>
  );
}

export function AnswerPanel({
  messages,
  chatId,
  scrollMemory,
  bottomInset,
  partial,
  streaming,
  streamStartedAt,
  streamLabel,
  scrollStep,
  scrollModifier,
  recordCombo,
  screenshotCombo,
  onTogglePreview,
  onCopyMessage,
  onRemoveMessage,
  onResendMessage,
}: AnswerPanelProps) {
  const {
    scrollRef,
    showJump,
    onScroll,
    resetToBottom,
    syncJump,
    snapshot,
    restoreTop,
    keepBottom,
  } = useStickToBottom();
  useHotkeyScroll(scrollRef, scrollStep, scrollModifier);
  useWheelPassThrough(scrollRef);

  // Синхронно до пейнта: иначе браузер показал бы кадр со старой позицией
  // и видимый «полёт сверху вниз» при переключении чата.
  useLayoutEffect(() => {
    const saved = scrollMemory.current;
    scrollMemory.current = null;
    if (saved !== null && saved.chatId === chatId && !saved.atBottom) restoreTop(saved.top);
    else resetToBottom();
  }, [chatId, scrollMemory, resetToBottom, restoreTop]);

  // The panel leaves with mini mode and notes; it notes where this chat stood so
  // the return lands on the same place. A layout cleanup still sees the element.
  const chatIdRef = useLatestRef(chatId);
  useLayoutEffect(
    () => () => {
      const position = snapshot();
      if (position !== null) scrollMemory.current = { chatId: chatIdRef.current, ...position };
    },
    [snapshot, scrollMemory, chatIdRef],
  );

  // Starts at the mounted history's length: the mount itself is placed by the
  // layout effect above (bottom, or the remembered spot), only a message that
  // arrives later may scroll — a user's own one, to the bottom.
  // The composer opening over the ledger pads it; a reader at the bottom stays at the bottom.
  useLayoutEffect(() => {
    keepBottom();
  }, [bottomInset, keepBottom]);

  const prevMessageCount = useRef(messages.length);
  useEffect(() => {
    const grew = messages.length > prevMessageCount.current;
    prevMessageCount.current = messages.length;
    if (grew && messages[messages.length - 1]?.role === "user") resetToBottom();
    else syncJump();
  }, [messages, resetToBottom, syncJump]);

  useEffect(() => {
    syncJump();
  }, [partial, syncJump]);

  const components = useAnswerMarkdownComponents(onTogglePreview);

  const empty = messages.length === 0 && !partial;
  const streamHasText = partial !== null && partial !== "";

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          style={{
            paddingBottom: bottomInset,
            clipPath: bottomInset > 0 ? `inset(0 0 ${String(bottomInset)}px 0)` : undefined,
          }}
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
              {streaming && !streamHasText && (
                <ThinkingIndicator startedAt={streamStartedAt} label={streamLabel} />
              )}
            </>
          )}
        </div>
        {showJump && <JumpToBottomButton inset={bottomInset} onClick={resetToBottom} />}
      </div>
    </section>
  );
}
