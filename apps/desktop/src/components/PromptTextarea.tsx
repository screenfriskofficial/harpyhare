import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Textarea } from "@/components/ui/textarea";
import { usePromptAutosize } from "@/hooks/usePromptAutosize";
import { extractImageItems } from "@/lib/composer";
import { cn } from "@/lib/utils";

export const PROMPT_SEND_KEY = "Enter";
/**
 * One line of the field, and therefore the composer's collapsed height: the
 * `min-h-10` below is the same 40px, so the pill is exactly one field row.
 */
export const PROMPT_ROW_HEIGHT_PX = 40;
const PROMPT_MAX_HEIGHT_PX = 160;

export interface PromptTextareaProps {
  value: string;
  onChange: (value: string) => void;
  onPaste: (items: DataTransferItemList) => void;
  onSend: () => void;
  /** Ref принадлежит `usePromptFocus`; тот же узел обслуживает и авторост. */
  fieldRef: RefObject<HTMLTextAreaElement | null>;
  /** Room on the right for whatever the card pins into its corner. */
  className?: string;
}

function pasteHasImages(items: DataTransferItemList) {
  return extractImageItems(items).length > 0;
}

export function PromptTextarea(props: PromptTextareaProps) {
  const { t } = useTranslation();
  usePromptAutosize(props.fieldRef, props.value, PROMPT_MAX_HEIGHT_PX);
  return (
    <Textarea
      ref={props.fieldRef}
      value={props.value}
      onChange={(e) => {
        props.onChange(e.target.value);
      }}
      onPaste={(e) => {
        const items = e.clipboardData.items;
        if (pasteHasImages(items)) e.preventDefault();
        props.onPaste(items);
      }}
      onKeyDown={(e) => {
        const sendShortcutPressed =
          e.key === PROMPT_SEND_KEY && !e.shiftKey && !e.nativeEvent.isComposing;
        if (sendShortcutPressed) {
          e.preventDefault();
          // Иначе дефолтный send-хоткей дошёл бы до `useWindowControls` в том же
          // keydown, и сообщение ушло бы дважды — флаг `streaming` ещё не успел бы подняться.
          e.stopPropagation();
          props.onSend();
        }
      }}
      spellCheck={false}
      placeholder={t("hud.composer.placeholder")}
      style={{ maxHeight: PROMPT_MAX_HEIGHT_PX }}
      // The same padding collapsed and open: the text never shifts when the card changes shape.
      className={cn(
        "min-h-10 min-w-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-3.5 py-2.5 text-body leading-5 focus-visible:ring-0",
        props.className,
      )}
    />
  );
}
