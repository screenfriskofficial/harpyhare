import { useCallback, type RefObject } from "react";
import { t } from "@/i18n";
import { copyImageToClipboard } from "@/ipc/commands";
import { lastMessageOf } from "@/lib/chat-messages";
import type { ChatMessage } from "@/lib/chats";
import { copyTextReportingError } from "@/lib/clipboard-text";
import { imagePngBase64, messageCopyImage, messageCopyText } from "@/lib/message-clipboard";
import { notifyError } from "@/lib/notify";
import type { ChatsApi } from "./useChats";

export interface MessageClipboard {
  copyMessage: (index: number) => void;
  copyLastAnswer: () => void;
}

/** The text, or the image when there is none: a screenshot without a caption has nothing else to copy. */
function copyMessageToClipboard(message: ChatMessage): void {
  const text = messageCopyText(message);
  if (text !== "") {
    void copyTextReportingError(text);
    return;
  }
  const image = messageCopyImage(message);
  if (!image) return;
  void imagePngBase64(image)
    .then(copyImageToClipboard)
    .catch(() => {
      notifyError(t("errors.copyImageFailed"));
    });
}

/** Copying out of the active chat: a message by its index, or the last answer. */
export function useMessageClipboard(chatsRef: RefObject<ChatsApi>): MessageClipboard {
  const copyMessage = useCallback(
    (index: number) => {
      const message = chatsRef.current.active.messages[index];
      if (message) copyMessageToClipboard(message);
    },
    [chatsRef],
  );
  const copyLastAnswer = useCallback(() => {
    const answer = lastMessageOf(chatsRef.current.active.messages, "assistant");
    if (answer) void copyTextReportingError(answer.text);
  }, [chatsRef]);
  return { copyMessage, copyLastAnswer };
}
