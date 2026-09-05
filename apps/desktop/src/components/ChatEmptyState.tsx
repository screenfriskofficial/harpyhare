import { MessagesSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ComboChip } from "@/components/ComboChip";

function EmptyHint({ combo, text }: { combo: string; text: string }) {
  if (combo === "") return null;
  return (
    <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
      <ComboChip combo={combo} />
      {text}
    </span>
  );
}

export function ChatEmptyState({
  recordCombo,
  screenshotCombo,
}: {
  recordCombo: string;
  screenshotCombo: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid h-full place-items-center">
      <div className="flex flex-col items-center gap-2.5 text-center">
        <span className="grid size-9 place-items-center rounded-lg bg-surface ring-1 ring-border ring-inset">
          <MessagesSquare className="size-4 text-muted-foreground" aria-hidden />
        </span>
        <span className="text-body text-muted-foreground">{t("hud.empty.title")}</span>
        <span className="flex flex-col items-center gap-1">
          <EmptyHint combo={recordCombo} text={t("hud.empty.recordHint")} />
          <EmptyHint combo={screenshotCombo} text={t("hud.empty.screenshotHint")} />
        </span>
      </div>
    </div>
  );
}
