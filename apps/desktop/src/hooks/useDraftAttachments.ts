import { useCallback, type RefObject } from "react";
import { t } from "@/i18n";
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

type AttachmentRejection = "limit" | "unsupported" | "unreadable";

function notifyAttachmentRejected(reason: AttachmentRejection): void {
  notify({
    variant: "error",
    title: t("errors.attachment"),
    message: t(`hud.attachments.${reason}`, { limit: ATTACHMENT_LIMIT }),
  });
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
        if (hasFileItems(items)) notifyAttachmentRejected("unsupported");
        return;
      }
      const slots = acceptedNewAttachments(draftAttachmentCount(id), files.length);
      if (slots < files.length) notifyAttachmentRejected("limit");
      let unreadable = 0;
      for (const file of files.slice(0, slots)) {
        const att = await fileToAttachmentOrNull(file);
        if (att) appendDraftAttachment(id, att);
        else unreadable += 1;
      }
      if (unreadable > 0) notifyAttachmentRejected("unreadable");
    },
    [draftAttachmentCount, appendDraftAttachment],
  );

  const addDraftImage = useCallback(
    async (id: string, dataUrl: string, mediaType: string) => {
      if (acceptedNewAttachments(draftAttachmentCount(id), 1) < 1) {
        notifyAttachmentRejected("limit");
        return;
      }
      const att = await fileToAttachmentOrNull(dataUrlToFile(dataUrl, mediaType));
      if (att) appendDraftAttachment(id, att);
      else notifyAttachmentRejected("unreadable");
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
