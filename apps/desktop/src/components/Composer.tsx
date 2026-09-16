import { memo, useCallback, useRef, useState, type RefObject } from "react";
import { ChatContextDialog } from "@/components/ChatContextDialog";
import { ActionGroup } from "@/components/composer/ActionGroup";
import { AttachmentList } from "@/components/composer/AttachmentList";
import { ComposerToolbar } from "@/components/composer/ComposerToolbar";
import { PROMPT_ROW_HEIGHT_PX, PromptTextarea } from "@/components/PromptTextarea";
import { useComposerEngagement } from "@/hooks/useComposerEngagement";
import { useComposerZone } from "@/hooks/useComposerZone";
import type { QuickAction } from "@/ipc/types";
import type { Chat, ChatPatch } from "@/lib/chats";
import { selectableModels, thinkingLocked, type ModelInfo } from "@/lib/models";
import type { Pipeline } from "@/lib/pipeline-types";
import { cn } from "@/lib/utils";
import { QuickActionsBar } from "./QuickActionsBar";

export interface ComposerProps {
  chat: Chat;
  onPatch: (chatId: string, patch: ChatPatch) => void;
  onRemoveAttachment: (index: number) => void;
  onPaste: (items: DataTransferItemList) => void;
  onSend: () => void;
  onStop: () => void;
  onClearHistory: () => void;
  onRetry: () => void;
  onRestoreFocus: () => void;
  /** How far the open card reaches above the composer's slot; the chat ledger pads by it. */
  onOverflowChange: (px: number) => void;
  retryLabel: string;
  streaming: boolean;
  showRetry: boolean;
  presets: { id: string; name: string }[];
  pipelines: Pipeline[];
  pipelinesReady: boolean;
  models: ModelInfo[];
  modelProvidersMissingKey: readonly string[];
  onCaptureRegion: () => void;
  promptRef: RefObject<HTMLTextAreaElement | null>;
  quickActions: QuickAction[];
  quickActionCombo: string;
  onQuickAction: (action: QuickAction) => void;
}

/** One line of the field: the card's collapsed height, and the source of its corner radius. */
const PILL_HEIGHT_PX = PROMPT_ROW_HEIGHT_PX;
/**
 * The same radius in both states — the pill is round only because it is as
 * tall as two radii. A radius that switched with the state read as a bigger
 * border on the pill and had to be animated between two shapes.
 */
const CARD_RADIUS_PX = PILL_HEIGHT_PX / 2;
/** Between the quick actions and the card, when the actions are there. */
const BAR_GAP_PX = 6;
/** Opening and closing overshoot a little, like a sheet; typing grows the card plainly. */
const OPEN_CLOSE_TRANSITION = "height 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)";
const GROW_TRANSITION = "height 0.15s ease-out";
/** Room the field and the toolbar leave for the buttons pinned into the card's corner. */
const ACTION_ROOM_CLASS = "pr-12";
const ACTION_ROOM_WITH_RETRY_CLASS = "pr-20";

/**
 * A compact pill while the draft is empty and the field is not in use; a card
 * with the toolbar once the field is focused or clicked, or once there is
 * something in it (`useComposerEngagement`). The card opens upward over the
 * chat ledger instead of pushing it: the composer keeps a slot of its
 * collapsed height in the column, measures how far the open card reaches
 * above that slot (`useComposerZone`) and reports it, so the ledger only pads
 * its bottom by that much and never changes size itself. The toolbar stays
 * mounted in both states — the card's animated height clips it, exactly as in
 * the original — so opening and closing are the same motion played both ways.
 *
 * `memo`: во время стрима `App` рендерится на каждый rAF-кадр раскрытия, а
 * входы композера при этом не меняются. Работает, пока App передаёт
 * стабильные колбэки — inline-стрелка в пропсах сведёт мемоизацию на нет.
 */
export const Composer = memo(function Composer(props: ComposerProps) {
  const { chat, onPatch, onRestoreFocus, onSend, promptRef } = props;
  const modelOptions = selectableModels(props.models, chat.model);
  const thinkingDisabled = thinkingLocked(modelOptions, chat.model);
  const [contextOpen, setContextOpen] = useState(false);
  const hasContent = chat.draft !== "" || chat.draftAttachments.length > 0;
  const { expanded, switching, send, onCardFocus, onCardMouseDown, onCardBlur, disengage } =
    useComposerEngagement({ promptRef, onRestoreFocus, onSend, hasContent });

  const cardRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const { slot, cardHeight } = useComposerZone(
    { card: cardRef, row: rowRef, content: contentRef, bar: barRef },
    expanded,
    BAR_GAP_PX,
    props.onOverflowChange,
  );
  const transition = switching ? OPEN_CLOSE_TRANSITION : GROW_TRANSITION;
  const onParamsClosed = useCallback(
    (pressedOutside: Element | null) => {
      // The keyboard, the trigger or a press on the card itself: the caret
      // comes back to the field. A press elsewhere chose its own focus — or
      // started a text selection in the ledger that a jumping caret would cut —
      // and the card treats it as the caret leaving.
      if (pressedOutside === null || cardRef.current?.contains(pressedOutside)) onRestoreFocus();
      else disengage();
    },
    [onRestoreFocus, disengage],
  );

  const openContextDialog = useCallback(() => {
    setContextOpen(true);
  }, []);
  const closeContextDialog = useCallback(() => {
    setContextOpen(false);
    onRestoreFocus();
  }, [onRestoreFocus]);
  const onDraftChange = useCallback(
    (draft: string) => {
      onPatch(chat.id, { draft });
    },
    [onPatch, chat.id],
  );

  const actionRoom = props.showRetry ? ACTION_ROOM_WITH_RETRY_CLASS : ACTION_ROOM_CLASS;
  return (
    <section className="relative shrink-0" style={{ height: slot ?? undefined }}>
      <div
        className={cn(
          "z-10 flex flex-col",
          // In the flow until the first measurement, then anchored to the slot's bottom edge.
          slot !== null && "absolute inset-x-0 bottom-0",
        )}
        style={{ gap: BAR_GAP_PX }}
      >
        <div ref={barRef} className="empty:hidden">
          <QuickActionsBar
            actions={props.quickActions}
            combo={props.quickActionCombo}
            disabled={props.streaming}
            onRun={props.onQuickAction}
          />
        </div>
        <div
          ref={cardRef}
          data-expanded={expanded}
          className="relative overflow-hidden bg-card/70 shadow-raise ring-1 ring-border ring-inset focus-within:ring-ring/60 motion-reduce:transition-none"
          style={{ height: cardHeight ?? undefined, borderRadius: CARD_RADIUS_PX, transition }}
          onMouseDown={onCardMouseDown}
          onFocus={onCardFocus}
          onBlur={onCardBlur}
        >
          <div ref={contentRef}>
            <div ref={rowRef} className="flex">
              <PromptTextarea
                fieldRef={promptRef}
                value={chat.draft}
                onChange={onDraftChange}
                onPaste={props.onPaste}
                onSend={send}
                className={actionRoom}
              />
            </div>
            <AttachmentList
              attachments={chat.draftAttachments}
              onRemove={props.onRemoveAttachment}
            />
            <ComposerToolbar
              shown={expanded}
              className={actionRoom}
              chat={chat}
              onPatch={onPatch}
              onClearHistory={props.onClearHistory}
              hasContext={chat.context.trim() !== ""}
              onOpenContext={openContextDialog}
              modelOptions={modelOptions}
              modelProvidersMissingKey={props.modelProvidersMissingKey}
              thinkingDisabled={thinkingDisabled}
              presets={props.presets}
              pipelines={props.pipelines}
              pipelinesReady={props.pipelinesReady}
              streaming={props.streaming}
              onCaptureRegion={props.onCaptureRegion}
              onClosed={onParamsClosed}
            />
          </div>
          <ActionGroup
            streaming={props.streaming}
            showRetry={props.showRetry}
            retryLabel={props.retryLabel}
            canSend={hasContent}
            onStop={props.onStop}
            onRetry={props.onRetry}
            onSend={send}
          />
        </div>
      </div>
      <ChatContextDialog
        open={contextOpen}
        chat={chat}
        onPatch={onPatch}
        onClose={closeContextDialog}
        onRestoreFocus={onRestoreFocus}
      />
    </section>
  );
});
