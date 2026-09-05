import { Maximize2 } from "lucide-react";
import { IconButton } from "@/components/IconButton";
import { ShortcutTooltip } from "@/components/ShortcutTooltip";
import { StatusOrb } from "@/components/StatusOrb";
import { LiquidMetalBorder } from "@/components/ui/liquid-metal-border";
import { ORB_STATE_IDLE, type OrbState } from "@/components/ui/thinking-orbs";
import { useWindowDrag } from "@/hooks/useWindowDrag";
import type { RecorderState } from "@/ipc/types";
import { formatCombo } from "@/lib/hotkeys";
import { isActivityStatus, miniStatus, type MiniStatus } from "@/lib/mini-status";
import { cn } from "@/lib/utils";

const STATUS_VIEW: Record<MiniStatus, { label: string; labelClass: string; orb: OrbState }> = {
  recording: {
    label: "Запись",
    labelClass: "text-foreground",
    orb: "listening",
  },
  transcribing: {
    label: "Расшифровка…",
    labelClass: "text-muted-foreground",
    orb: "working",
  },
  streaming: {
    label: "Ответ…",
    labelClass: "text-muted-foreground",
    orb: "composing",
  },
  error: {
    label: "Ошибка",
    labelClass: "text-destructive",
    orb: ORB_STATE_IDLE,
  },
  unread: {
    label: "Ответ готов",
    labelClass: "text-foreground",
    orb: ORB_STATE_IDLE,
  },
  idle: {
    label: "",
    labelClass: "text-muted-foreground",
    orb: ORB_STATE_IDLE,
  },
};

const EXPAND_LABEL = "Развернуть окно";

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
  const onDragMouseDown = useWindowDrag();
  const view = STATUS_VIEW[miniStatus(state, streaming, hasError, unreadAnswer)];
  return (
    <div className="h-screen w-screen p-1" onMouseDown={onDragMouseDown}>
      <div className="relative flex h-full items-center gap-2 rounded-full bg-background py-1 pr-1 pl-3 ring-1 ring-border ring-inset">
        <LiquidMetalBorder active={isActivityStatus(state, streaming)} />
        <StatusOrb state={view.orb} />
        <span className={cn("min-w-0 flex-1 truncate text-caption", view.labelClass)}>
          {view.label}
        </span>
        <ShortcutTooltip label={EXPAND_LABEL} shortcut={formatCombo(expandCombo)}>
          <IconButton title="" aria-label={EXPAND_LABEL} onClick={onExpand}>
            <Maximize2 />
          </IconButton>
        </ShortcutTooltip>
      </div>
    </div>
  );
}
