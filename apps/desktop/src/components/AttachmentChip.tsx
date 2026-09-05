import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Attachment } from "@/lib/composer";

export interface AttachmentChipProps {
  attachment: Attachment;
  onRemove: () => void;
}

export function AttachmentChip({ attachment, onRemove }: AttachmentChipProps) {
  const { t } = useTranslation();
  return (
    <div className="group relative size-12 overflow-hidden rounded-md ring-1 ring-border ring-inset">
      <img
        src={attachment.preview}
        alt={t("hud.attachments.alt")}
        className="size-full object-cover"
      />
      <button
        type="button"
        onClick={onRemove}
        aria-label={t("hud.attachments.remove")}
        className="pointer-events-none absolute top-1 right-1 grid size-4.5 place-items-center rounded-full bg-black/75 text-white opacity-0 outline-none group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
