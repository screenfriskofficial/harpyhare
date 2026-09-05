import { MessagesSquare, NotebookText, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/IconButton";
import { ShortcutTooltip } from "@/components/ShortcutTooltip";
import { DOCK_BUTTON_CLASS } from "@/components/ToolbarDock";
import { APP_MODES, modeHint, modeLabel, type AppModeId } from "@/lib/modes";
import { cn } from "@/lib/utils";

const MODE_ICONS: Record<AppModeId, LucideIcon> = {
  chat: MessagesSquare,
  notes: NotebookText,
};

const ACTIVE_MODE_CLASS = "bg-surface-active text-foreground hover:text-foreground";
const MODE_TOOLTIP_SIDE = "bottom";

export interface ModeSwitchProps {
  mode: AppModeId;
  combo: string;
  onSelect: (mode: AppModeId) => void;
}

export function ModeSwitch({ mode, combo, onSelect }: ModeSwitchProps) {
  const { t } = useTranslation();
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {APP_MODES.map((entry) => {
        const Icon = MODE_ICONS[entry.id];
        const active = entry.id === mode;
        return (
          <ShortcutTooltip
            key={entry.id}
            label={modeHint(entry.id)}
            shortcut={combo}
            side={MODE_TOOLTIP_SIDE}
          >
            <IconButton
              title=""
              aria-label={t("modes.ariaLabel", { mode: modeLabel(entry.id) })}
              aria-pressed={active}
              className={cn(DOCK_BUTTON_CLASS, active && ACTIVE_MODE_CLASS)}
              onClick={() => {
                onSelect(entry.id);
              }}
            >
              <Icon />
            </IconButton>
          </ShortcutTooltip>
        );
      })}
    </span>
  );
}
