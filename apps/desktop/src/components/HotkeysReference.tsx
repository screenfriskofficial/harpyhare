import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { ComboChip } from "@/components/ComboChip";
import { SectionLabel } from "@/components/SectionLabel";
import type { HotkeyBinding } from "@/ipc/types";
import { hotkeyGroups } from "@/lib/hotkeys";
import { cn } from "@/lib/utils";

/**
 * The only place in the UI that names the opacity and font-size families and
 * the prompt-field keys: none of them has a row in the launcher.
 */
export function HotkeysReference({ hotkeys }: { hotkeys: HotkeyBinding[] }) {
  // `hotkeyGroups` reads labels through the shared `t`; subscribing re-renders the list on a language change.
  useTranslation();
  const groups = hotkeyGroups(hotkeys);
  return (
    <div className="grid grid-cols-[max-content_1fr] items-center gap-x-2.5 gap-y-1">
      {groups.map((group, index) => (
        <Fragment key={group.title}>
          <SectionLabel className={cn("col-span-2", index > 0 && "mt-2.5")}>
            {group.title}
          </SectionLabel>
          {group.hints.map((hint) => (
            <Fragment key={hint.label}>
              <ComboChip combo={hint.combo} />
              <span className="min-w-0 truncate text-caption text-muted-foreground">
                {hint.label}
              </span>
            </Fragment>
          ))}
        </Fragment>
      ))}
    </div>
  );
}
