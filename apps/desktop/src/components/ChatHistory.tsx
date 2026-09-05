import { Copy, RotateCw, Trash2 } from "lucide-react";
import { memo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { type Components } from "react-markdown";
import { IconButton } from "@/components/IconButton";
import {
  ICON_CLUSTER_BUTTON_CLASS,
  ICON_CLUSTER_BUTTON_SIZE_CLASS,
  ICON_CLUSTER_CLASS,
} from "@/components/IconCluster";
import { PROSE_MARKDOWN_CLASS } from "@/components/markdown-config";
import { MarkdownChunk } from "@/components/MarkdownChunk";
import type { ChatMessage } from "@/lib/chats";
import { imageDataUrl, type ImagePayload } from "@/lib/composer";
import { isMessageCopyable } from "@/lib/message-clipboard";
import { messageKey } from "@/lib/message-keys";
import { cn } from "@/lib/utils";

/**
 * Показ/скрытие мгновенные, без `transition-opacity`: в прозрачном фреймлесс-окне
 * анимация прозрачности выносит элемент в отдельный композитный слой WKWebView,
 * и при его схлопывании остаются несмытые пиксели.
 */
const MESSAGE_ACTIONS_REVEAL_CLASS =
  "pointer-events-none opacity-0 group-hover/msg:pointer-events-auto group-hover/msg:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100";

function MessageActionButton({
  title,
  onClick,
  className,
  children,
}: {
  title: string;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <IconButton
      title={title}
      onClick={onClick}
      className={cn(ICON_CLUSTER_BUTTON_SIZE_CLASS, ICON_CLUSTER_BUTTON_CLASS, className)}
    >
      {children}
    </IconButton>
  );
}

function MessageActions({
  onCopy,
  onRemove,
  onResend,
  className,
}: {
  onCopy: (() => void) | null;
  onRemove: () => void;
  onResend: (() => void) | null;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={cn(MESSAGE_ACTIONS_REVEAL_CLASS, "shrink-0", className)}>
      {onCopy && (
        <MessageActionButton title={t("hud.history.copy")} onClick={onCopy}>
          <Copy className="size-3.5" />
        </MessageActionButton>
      )}
      {onResend && (
        <MessageActionButton title={t("hud.history.resend")} onClick={onResend}>
          <RotateCw className="size-3.5" />
        </MessageActionButton>
      )}
      <MessageActionButton
        title={t("hud.history.remove")}
        onClick={onRemove}
        className="hover:text-destructive"
      >
        <Trash2 className="size-3.5" />
      </MessageActionButton>
    </div>
  );
}

/**
 * У ответа ассистента жёлоба справа нет: кластер лежит поверх сообщения в
 * правом нижнем углу, где последняя строка абзаца почти всегда короткая.
 */
function MessageShell({
  align,
  onCopy,
  onRemove,
  onResend,
  children,
}: {
  align: "start" | "end";
  onCopy: (() => void) | null;
  onRemove: () => void;
  onResend: (() => void) | null;
  children: ReactNode;
}) {
  if (align === "end") {
    return (
      <div className="group/msg flex items-start justify-end gap-1">
        <MessageActions
          onCopy={onCopy}
          onRemove={onRemove}
          onResend={onResend}
          className={ICON_CLUSTER_CLASS}
        />
        {children}
      </div>
    );
  }
  return (
    <div className="group/msg relative">
      {children}
      <MessageActions
        onCopy={onCopy}
        onRemove={onRemove}
        onResend={onResend}
        className={cn(ICON_CLUSTER_CLASS, "absolute right-0 bottom-0")}
      />
    </div>
  );
}

function MessageImages({ images }: { images: ImagePayload[] }) {
  const { t } = useTranslation();
  if (images.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {images.map((image, i) => (
        <img
          key={i}
          src={imageDataUrl(image)}
          alt={t("hud.history.imageAlt")}
          className="max-h-48 max-w-full rounded-md object-contain ring-1 ring-border ring-inset"
        />
      ))}
    </div>
  );
}

function UserBubble({ text, images }: { text: string; images: ImagePayload[] }) {
  return (
    <div className="flex max-w-[85%] flex-col gap-1.5 rounded-lg bg-surface-active px-3 py-1.5 text-chat text-foreground ring-1 ring-border ring-inset">
      <MessageImages images={images} />
      {text !== "" && <span className="min-w-0 break-words whitespace-pre-wrap">{text}</span>}
    </div>
  );
}

function Assistant({ text, components }: { text: string; components: Components }) {
  return (
    <div className={PROSE_MARKDOWN_CLASS}>
      <MarkdownChunk text={text} components={components} />
    </div>
  );
}

export interface ChatHistoryProps {
  messages: ChatMessage[];
  streaming: boolean;
  components: Components;
  onCopyMessage: (index: number) => void;
  onRemoveMessage: (index: number) => void;
  onResendMessage: (index: number) => void;
}

/** `memo`: история не перепарсивается на каждый кадр стрима — все пропсы стабильны. */
export const ChatHistory = memo(function ChatHistory({
  messages,
  streaming,
  components,
  onCopyMessage,
  onRemoveMessage,
  onResendMessage,
}: ChatHistoryProps) {
  return (
    <>
      {messages.map((m, i) => (
        <MessageShell
          key={messageKey(m)}
          align={m.role === "user" ? "end" : "start"}
          onCopy={
            isMessageCopyable(m)
              ? () => {
                  onCopyMessage(i);
                }
              : null
          }
          onRemove={() => {
            onRemoveMessage(i);
          }}
          onResend={
            m.role === "user" && !streaming
              ? () => {
                  onResendMessage(i);
                }
              : null
          }
        >
          {m.role === "user" ? (
            <UserBubble text={m.text} images={m.images} />
          ) : (
            <Assistant text={m.text} components={components} />
          )}
        </MessageShell>
      ))}
    </>
  );
});
