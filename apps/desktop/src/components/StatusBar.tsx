import type { ReactNode } from "react";
import { StatusOrb } from "@/components/StatusOrb";
import { ORB_STATE_IDLE, type OrbState } from "@/components/ui/thinking-orbs";
import { useWindowDrag } from "@/hooks/useWindowDrag";
import type { RecorderState } from "@/ipc/types";
import { ToolbarDock, type ToolbarDockItem } from "./ToolbarDock";

export interface StatusBarProps {
  state: RecorderState;
  modeSwitch: ReactNode;
  tabs: ReactNode;
  dockItems: ToolbarDockItem[];
}

function recorderOrb(state: RecorderState): OrbState {
  if (state === "recording") return "listening";
  if (state === "transcribing") return "working";
  return ORB_STATE_IDLE;
}

export function StatusBar({ state, modeSwitch, tabs, dockItems }: StatusBarProps) {
  const onDragMouseDown = useWindowDrag();
  const orb = recorderOrb(state);

  return (
    <header className="flex min-h-7 items-center gap-2" onMouseDown={onDragMouseDown}>
      <StatusOrb state={orb} />
      {tabs}
      <span className="min-w-0 flex-1" />
      <ToolbarDock items={dockItems} leading={modeSwitch} />
    </header>
  );
}
