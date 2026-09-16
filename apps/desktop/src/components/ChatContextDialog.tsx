import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { Chat, ChatPatch } from "@/lib/chats";

export interface ChatContextDialogProps {
  open: boolean;
  chat: Chat;
  onPatch: (chatId: string, patch: ChatPatch) => void;
  onClose: () => void;
  /** Куда вернуть каретку после закрытия — в поле промпта, а не на кнопку тулбара. */
  onRestoreFocus: () => void;
}

const DIALOG_WIDTH_PX = 480;

/**
 * The one piece of prompt input that belongs to a chat rather than to a
 * pipeline: what this particular conversation is about. Library materials
 * are chosen by the prompt pipeline in the launcher, not here.
 *
 * Черновик контекста живёт в самом диалоге и снимается с чата в момент
 * открытия (`key` по чату снаружи не нужен: диалог монтируется по `open`).
 * Сохранение пишет черновик в тот чат, для которого диалог открывали — даже
 * если пользователь успел переключить вкладку.
 */
function ChatContextForm({
  chat,
  onPatch,
  onClose,
}: Pick<ChatContextDialogProps, "chat" | "onPatch" | "onClose">) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(chat.context);
  const [chatId] = useState(chat.id);

  const save = () => {
    onPatch(chatId, { context: draft });
    onClose();
  };

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <Textarea
          rows={8}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          placeholder={t("hud.contextDialog.placeholder")}
          aria-label={t("hud.contextDialog.title")}
          className="max-h-64 overflow-y-auto"
        />
      </div>
      <DialogFooter className="shrink-0">
        <Button variant="ghost" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button onClick={save}>{t("common.save")}</Button>
      </DialogFooter>
    </>
  );
}

export function ChatContextDialog(props: ChatContextDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent
        panelWidthPx={DIALOG_WIDTH_PX}
        className="flex flex-col overflow-hidden"
        // Radix возвращает фокус на кнопку тулбара ПОСЛЕ exit-анимации и
        // перебил бы наш rAF-возврат в поле промпта: отменяем и ставим сами.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          props.onRestoreFocus();
        }}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>{t("hud.contextDialog.title")}</DialogTitle>
          <DialogDescription>{t("hud.contextDialog.ownTextHint")}</DialogDescription>
        </DialogHeader>
        {props.open && (
          <ChatContextForm chat={props.chat} onPatch={props.onPatch} onClose={props.onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}
