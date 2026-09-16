import { AttachmentChip } from "@/components/AttachmentChip";
import type { Attachment } from "@/lib/composer";

export interface AttachmentListProps {
  attachments: Attachment[];
  onRemove: (index: number) => void;
}

export function AttachmentList({ attachments, onRemove }: AttachmentListProps) {
  if (attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 px-2.5 pb-2">
      {attachments.map((att, i) => (
        // The key is the position: attachments have no id, and two identical
        // pastes preview letter for letter the same; the list is short and
        // never reordered.
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
