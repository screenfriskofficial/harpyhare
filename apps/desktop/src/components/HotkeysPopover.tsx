import { Keyboard } from "lucide-react";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { ComboChip } from "@/components/ComboChip";
import { IconButton } from "@/components/IconButton";
import { SectionLabel } from "@/components/SectionLabel";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { HotkeyBinding } from "@/ipc/types";
import { hotkeyGroups } from "@/lib/hotkeys";
import { cn } from "@/lib/utils";

export interface HotkeysPopoverProps {
  hotkeys: HotkeyBinding[];
  triggerClass?: string;
}

const POPOVER_COLLISION_PADDING_PX = 8;

export function HotkeysPopover({ hotkeys, triggerClass }: HotkeysPopoverProps) {
  // `hotkeyGroups` берёт подписи через общий `t`; подписка нужна, чтобы попап перерисовался на смену языка.
  const { t } = useTranslation();
  const groups = hotkeyGroups(hotkeys);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton title="" aria-label={t("hud.header.hotkeys")} className={triggerClass}>
          <Keyboard />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent
        side="left"
        align="start"
        collisionPadding={POPOVER_COLLISION_PADDING_PX}
        className="max-h-(--radix-popover-content-available-height) w-80 max-w-(--radix-popover-content-available-width) overflow-y-auto p-3"
      >
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
      </PopoverContent>
    </Popover>
  );
}
