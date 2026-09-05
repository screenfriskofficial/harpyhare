import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { StatusOrb } from "@/components/StatusOrb";
import { ORB_STATE_IDLE, type OrbState } from "@/components/ui/thinking-orbs";
import { useWindowDrag } from "@/hooks/useWindowDrag";
import type { RecorderState } from "@/ipc/types";
import { cn } from "@/lib/utils";
import { ToolbarDock, type ToolbarDockItem } from "./ToolbarDock";

export interface ContextUsage {
  usedTokens: number;
  maxTokens: number;
}

export interface StatusBarProps {
  state: RecorderState;
  modeSwitch: ReactNode;
  tabs: ReactNode;
  dockItems: ToolbarDockItem[];
  contextUsage: ContextUsage | null;
}

const CONTEXT_USAGE_WARN_PERCENT = 80;
const CONTEXT_GAUGE_MIN_FILL_PERCENT = 3;
const PERCENT_SCALE = 100;

function ContextUsageGauge({ usage }: { usage: ContextUsage }) {
  const { t } = useTranslation();
  const percent = Math.min(
    PERCENT_SCALE,
    Math.round((usage.usedTokens / usage.maxTokens) * PERCENT_SCALE),
  );
  // `{{used, number}}` форматирует разряды по языку интерфейса, а не по жёсткой локали.
  const title = t("hud.header.contextUsage", { used: usage.usedTokens, max: usage.maxTokens });
  return (
    <div className="flex shrink-0 items-center gap-1.5 px-1" title={title}>
      <span className="h-1 w-10 overflow-hidden rounded-full bg-surface-active">
        <span
          className={cn(
            "block h-full rounded-full transition-[width] duration-300",
            percent >= CONTEXT_USAGE_WARN_PERCENT ? "bg-destructive" : "bg-muted-foreground/60",
          )}
          style={{ width: `${String(Math.max(CONTEXT_GAUGE_MIN_FILL_PERCENT, percent))}%` }}
        />
      </span>
      <span className="text-hint text-muted-foreground tabular-nums">{percent}%</span>
    </div>
  );
}

function recorderOrb(state: RecorderState): OrbState {
  if (state === "recording") return "listening";
  if (state === "transcribing") return "working";
  return ORB_STATE_IDLE;
}

export function StatusBar({ state, modeSwitch, tabs, dockItems, contextUsage }: StatusBarProps) {
  const onDragMouseDown = useWindowDrag();
  const orb = recorderOrb(state);

  return (
    <header className="flex min-h-7 items-center gap-2" onMouseDown={onDragMouseDown}>
      <StatusOrb state={orb} />
      {tabs}
      <span className="min-w-0 flex-1" />
      <div className="flex shrink-0 items-center gap-1.5">
        {contextUsage && <ContextUsageGauge usage={contextUsage} />}
        <ToolbarDock items={dockItems} leading={modeSwitch} />
      </div>
    </header>
  );
}
