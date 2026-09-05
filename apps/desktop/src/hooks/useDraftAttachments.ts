import { useCallback, type RefObject } from "react";
import { dataUrlToFile, fileToAttachmentOrNull } from "@/lib/attachment-files";
import type { Chat } from "@/lib/chats";
import {
  acceptedNewAttachments,
  ATTACHMENT_LIMIT,
  extractImageItems,
  hasFileItems,
  type Attachment,
} from "@/lib/composer";
import { notify } from "@/lib/notify";

const ATTACHMENT_LIMIT_NOTICE = `Больше ${String(ATTACHMENT_LIMIT)} вложений в одном сообщении нельзя`;
const UNSUPPORTED_FORMAT_NOTICE = "Такой формат картинки не поддерживается";
const ATTACHMENT_READ_NOTICE = "Не удалось прочитать картинку";

function notifyAttachmentRejected(message: string): void {
  notify({ variant: "error", title: "Вложение", message });
}

export type PatchChatFn = (id: string, fn: (chat: Chat) => Chat) => void;

export interface DraftAttachmentsApi {
  addDraftAttachments: (id: string, items: DataTransferItemList) => Promise<void>;
  addDraftImage: (id: string, dataUrl: string, mediaType: string) => Promise<void>;
  removeDraftAttachment: (id: string, index: number) => void;
}

/** Черновые вложения чата: вставка, снимок, удаление и лимит на количество. */
export function useDraftAttachments(
  chatsRef: RefObject<Chat[]>,
  patch: PatchChatFn,
): DraftAttachmentsApi {
  // Читается из ref, а не через апдейтер `setChats`: тот исполняется синхронно
  // только пока у React нет отложенных обновлений — во время стрима они есть
  // каждый кадр, и счётчик молча оставался бы нулём.
  const draftAttachmentCount = useCallback(
    (id: string): number => chatsRef.current.find((c) => c.id === id)?.draftAttachments.length ?? 0,
    [chatsRef],
  );

  const appendDraftAttachment = useCallback(
    (id: string, att: Attachment) => {
      patch(id, (c) =>
        c.draftAttachments.length >= ATTACHMENT_LIMIT
          ? c
          : { ...c, draftAttachments: [...c.draftAttachments, att] },
      );
    },
    [patch],
  );

  const addDraftAttachments = useCallback(
    async (id: string, items: DataTransferItemList) => {
      const files = extractImageItems(items);
      if (files.length === 0) {
        if (hasFileItems(items)) notifyAttachmentRejected(UNSUPPORTED_FORMAT_NOTICE);
        return;
      }
      const slots = acceptedNewAttachments(draftAttachmentCount(id), files.length);
      if (slots < files.length) notifyAttachmentRejected(ATTACHMENT_LIMIT_NOTICE);
      let unreadable = 0;
      for (const file of files.slice(0, slots)) {
        const att = await fileToAttachmentOrNull(file);
        if (att) appendDraftAttachment(id, att);
        else unreadable += 1;
      }
      if (unreadable > 0) notifyAttachmentRejected(ATTACHMENT_READ_NOTICE);
    },
    [draftAttachmentCount, appendDraftAttachment],
  );

  const addDraftImage = useCallback(
    async (id: string, dataUrl: string, mediaType: string) => {
      if (acceptedNewAttachments(draftAttachmentCount(id), 1) < 1) {
        notifyAttachmentRejected(ATTACHMENT_LIMIT_NOTICE);
        return;
      }
      const att = await fileToAttachmentOrNull(dataUrlToFile(dataUrl, mediaType));
      if (att) appendDraftAttachment(id, att);
      else notifyAttachmentRejected(ATTACHMENT_READ_NOTICE);
    },
    [draftAttachmentCount, appendDraftAttachment],
  );

  const removeDraftAttachment = useCallback(
    (id: string, index: number) => {
      patch(id, (c) => ({
        ...c,
        draftAttachments: c.draftAttachments.filter((_, i) => i !== index),
      }));
    },
    [patch],
  );

  return { addDraftAttachments, addDraftImage, removeDraftAttachment };
}
