import { MessagesSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ComboChip } from "@/components/ComboChip";
import { formatCombo } from "@/lib/hotkeys";

/**
 * One row of a two-column grid: the chips share the width of the widest one and
 * the labels share a left edge, so rows line up however long each part is.
 */
function EmptyHint({ combo, text }: { combo: string; text: string }) {
  if (combo === "") return null;
  return (
    <>
      <ComboChip combo={formatCombo(combo)} />
      <span className="text-caption text-muted-foreground">{text}</span>
    </>
  );
}

export function ChatEmptyState({
  recordCombo,
  recordToggle,
  screenshotCombo,
}: {
  recordCombo: string;
  /** `Settings.record_toggle`: the hint must say "press", not "hold", in toggle mode. */
  recordToggle: boolean;
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
        <span className="mt-1 grid grid-cols-[max-content_auto] items-center gap-x-2.5 gap-y-1.5 text-left">
          <EmptyHint
            combo={recordCombo}
            text={recordToggle ? t("hud.empty.recordToggleHint") : t("hud.empty.recordHint")}
          />
          <EmptyHint combo={screenshotCombo} text={t("hud.empty.screenshotHint")} />
        </span>
      </div>
    </div>
  );
}
