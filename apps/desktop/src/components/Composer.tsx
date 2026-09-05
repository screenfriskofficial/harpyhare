import { ArrowUp, Crop, Eraser, NotebookText, RotateCcw, Square } from "lucide-react";
import { memo, useCallback, useState, type RefObject } from "react";
import { ChatContextDialog } from "@/components/ChatContextDialog";
import { PROMPT_SEND_KEY, PromptTextarea } from "@/components/PromptTextarea";
import {
  RequestParamsPopover,
  type RequestParamsPopoverProps,
} from "@/components/RequestParamsPopover";
import { ShortcutTooltip } from "@/components/ShortcutTooltip";
import { Button } from "@/components/ui/button";
import type { QuickAction } from "@/ipc/types";
import type { Chat, ChatPatch } from "@/lib/chats";
import type { Attachment } from "@/lib/composer";
import type { ContextLibrary } from "@/lib/context-library";
import { formatCombo } from "@/lib/hotkeys";
import { selectableModels, thinkingLocked, type ModelInfo } from "@/lib/models";
import { AttachmentChip } from "./AttachmentChip";
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
  retryLabel: string;
  streaming: boolean;
  showRetry: boolean;
  presets: { id: string; name: string }[];
  library: ContextLibrary;
  models: ModelInfo[];
  modelProvidersMissingKey: readonly string[];
  onCaptureRegion: () => void;
  promptRef: RefObject<HTMLTextAreaElement | null>;
  quickActions: QuickAction[];
  quickActionCombo: string;
  onQuickAction: (action: QuickAction) => void;
}

const SEND_LABEL = "Отправить";

interface AttachmentListProps {
  attachments: Attachment[];
  onRemove: (index: number) => void;
}

function AttachmentList({ attachments, onRemove }: AttachmentListProps) {
  if (attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 px-2.5 pb-2">
      {attachments.map((att, i) => (
        // Ключ — позиция: у вложений нет id, а превью двух одинаковых вставок
        // совпадает буква в букву; список короткий и не переупорядочивается.
        <AttachmentChip
          key={i}
          attachment={att}
          onRemove={() => {
            onRemove(i);
          }}
        />
      ))}
    </div>
  );
}

type ComposerToolbarProps = RequestParamsPopoverProps &
  Pick<
    ComposerProps,
    | "onClearHistory"
    | "showRetry"
    | "onRetry"
    | "retryLabel"
    | "streaming"
    | "onStop"
    | "onSend"
    | "onCaptureRegion"
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
      <Button
        variant="ghost"
        size="icon-compact"
        onClick={props.onCaptureRegion}
        title="Снимок области экрана"
        aria-label="Снимок области экрана"
      >
        <Crop />
      </Button>
      <RequestParamsPopover
        chat={props.chat}
        onPatch={props.onPatch}
        modelOptions={props.modelOptions}
        modelProvidersMissingKey={props.modelProvidersMissingKey}
        thinkingDisabled={props.thinkingDisabled}
        presets={props.presets}
      />
      <div className="flex-1" />
      {props.showRetry && (
        <Button
          variant="ghost"
          size="icon-compact"
          onClick={props.onRetry}
          title={props.retryLabel}
          aria-label={props.retryLabel}
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
        <ShortcutTooltip label={SEND_LABEL} shortcut={formatCombo(PROMPT_SEND_KEY)}>
          <Button size="icon-compact" onClick={props.onSend} aria-label={SEND_LABEL}>
            <ArrowUp />
          </Button>
        </ShortcutTooltip>
      )}
    </div>
  );
}

/**
 * `memo`: во время стрима `App` рендерится на каждый rAF-кадр раскрытия, а
 * входы композера при этом не меняются. Работает, пока App передаёт
 * стабильные колбэки — inline-стрелка в пропсах сведёт мемоизацию на нет.
 */
export const Composer = memo(function Composer(props: ComposerProps) {
  const { chat, onPatch, onRestoreFocus } = props;
  const modelOptions = selectableModels(props.models, chat.model);
  const thinkingDisabled = thinkingLocked(modelOptions, chat.model);
  const [contextOpen, setContextOpen] = useState(false);
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
  return (
    <section>
      <QuickActionsBar
        actions={props.quickActions}
        combo={props.quickActionCombo}
        disabled={props.streaming}
        onRun={props.onQuickAction}
      />
      <div className="rounded-xl bg-card/70 shadow-raise ring-1 ring-border transition-[box-shadow] ring-inset focus-within:ring-ring/60">
        <PromptTextarea
          fieldRef={props.promptRef}
          value={chat.draft}
          onChange={onDraftChange}
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
          retryLabel={props.retryLabel}
          modelOptions={modelOptions}
          modelProvidersMissingKey={props.modelProvidersMissingKey}
          thinkingDisabled={thinkingDisabled}
          presets={props.presets}
          streaming={props.streaming}
          onStop={props.onStop}
          onSend={props.onSend}
          onCaptureRegion={props.onCaptureRegion}
        />
      </div>
      <ChatContextDialog
        open={contextOpen}
        chat={chat}
        library={props.library}
        onPatch={onPatch}
        onClose={closeContextDialog}
        onRestoreFocus={onRestoreFocus}
      />
    </section>
  );
});
