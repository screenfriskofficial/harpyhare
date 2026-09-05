import { Maximize2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/IconButton";
import { ShortcutTooltip } from "@/components/ShortcutTooltip";
import { StatusOrb } from "@/components/StatusOrb";
import { LiquidMetalBorder } from "@/components/ui/liquid-metal-border";
import { ORB_STATE_IDLE, type OrbState } from "@/components/ui/thinking-orbs";
import { useWindowDrag } from "@/hooks/useWindowDrag";
import type { TranslationKey } from "@/i18n";
import type { RecorderState } from "@/ipc/types";
import { formatCombo } from "@/lib/hotkeys";
import { isActivityStatus, miniStatus, type MiniStatus } from "@/lib/mini-status";
import { cn } from "@/lib/utils";

const STATUS_VIEW: Record<
  MiniStatus,
  { labelKey: TranslationKey | null; labelClass: string; orb: OrbState }
> = {
  recording: {
    labelKey: "hud.mini.recording",
    labelClass: "text-foreground",
    orb: "listening",
  },
  transcribing: {
    labelKey: "hud.mini.transcribing",
    labelClass: "text-muted-foreground",
    orb: "working",
  },
  streaming: {
    labelKey: "hud.mini.streaming",
    labelClass: "text-muted-foreground",
    orb: "composing",
  },
  error: {
    labelKey: "hud.mini.error",
    labelClass: "text-destructive",
    orb: ORB_STATE_IDLE,
  },
  unread: {
    labelKey: "hud.mini.unread",
    labelClass: "text-foreground",
    orb: ORB_STATE_IDLE,
  },
  idle: {
    labelKey: null,
    labelClass: "text-muted-foreground",
    orb: ORB_STATE_IDLE,
  },
};

export interface MiniHudProps {
  state: RecorderState;
  streaming: boolean;
  hasError: boolean;
  unreadAnswer: boolean;
  expandCombo: string;
  onExpand: () => void;
}

export function MiniHud({
  state,
  streaming,
  hasError,
  unreadAnswer,
  expandCombo,
  onExpand,
}: MiniHudProps) {
  const { t } = useTranslation();
  const onDragMouseDown = useWindowDrag();
  const view = STATUS_VIEW[miniStatus(state, streaming, hasError, unreadAnswer)];
  const expandLabel = t("hud.mini.expand");
  return (
    <div className="h-screen w-screen p-1" onMouseDown={onDragMouseDown}>
      <div className="relative flex h-full items-center gap-2 rounded-full bg-background py-1 pr-1 pl-3 ring-1 ring-border ring-inset">
        <LiquidMetalBorder active={isActivityStatus(state, streaming)} />
        <StatusOrb state={view.orb} />
        <span className={cn("min-w-0 flex-1 truncate text-caption", view.labelClass)}>
          {view.labelKey === null ? "" : t(view.labelKey)}
        </span>
        <ShortcutTooltip label={expandLabel} shortcut={formatCombo(expandCombo)}>
          <IconButton title="" aria-label={expandLabel} onClick={onExpand}>
            <Maximize2 />
          </IconButton>
        </ShortcutTooltip>
      </div>
    </div>
  );
}
