import type { RefObject } from "react";
import { Textarea } from "@/components/ui/textarea";
import { usePromptAutosize } from "@/hooks/usePromptAutosize";
import { extractImageItems } from "@/lib/composer";

export const PROMPT_SEND_KEY = "Enter";
const PROMPT_MAX_HEIGHT_PX = 160;
const PROMPT_PLACEHOLDER = "Расшифровка появится здесь — или напиши вопрос сам";

export interface PromptTextareaProps {
  value: string;
  onChange: (value: string) => void;
  onPaste: (items: DataTransferItemList) => void;
  onSend: () => void;
  /** Ref принадлежит `usePromptFocus`; тот же узел обслуживает и авторост. */
  fieldRef: RefObject<HTMLTextAreaElement | null>;
}

function pasteHasImages(items: DataTransferItemList) {
  return extractImageItems(items).length > 0;
}

export function PromptTextarea(props: PromptTextareaProps) {
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
      placeholder={PROMPT_PLACEHOLDER}
      style={{ maxHeight: PROMPT_MAX_HEIGHT_PX }}
      className="min-h-9 resize-none overflow-y-auto border-0 bg-transparent py-1.5 text-body focus-visible:ring-0"
    />
  );
}
