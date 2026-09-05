import { ArrowDownCircle, Copy, Cpu, Eye, EyeOff, Minus, ScrollText, Square } from "lucide-react";
import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChatTabs } from "@/components/ChatTabs";
import { HotkeysPopover } from "@/components/HotkeysPopover";
import { ModeSwitch } from "@/components/ModeSwitch";
import { StatusBar, type ContextUsage } from "@/components/StatusBar";
import { DOCK_BUTTON_CLASS, type ToolbarDockItem } from "@/components/ToolbarDock";
import type { HotkeyBinding, RecorderState } from "@/ipc/types";
import type { Chat } from "@/lib/chats";
import { effectiveCombo, formatCombo } from "@/lib/hotkeys";
import type { AppModeId } from "@/lib/modes";
import { cn } from "@/lib/utils";

export interface UpdateBadge {
  version: string;
  busy: boolean;
}

export interface AppHeaderProps {
  recorderState: RecorderState;
  hotkeys: HotkeyBinding[];
  update: UpdateBadge | null;
  chats: Chat[];
  activeId: string;
  streaming: Record<string, boolean>;
  unread: Record<string, boolean>;
  mode: AppModeId;
  canCopy: boolean;
  canTeleprompt: boolean;
  contextUsage: ContextUsage | null;
  screenShareVisible: boolean;
  onSelectChat: (id: string) => void;
  onRemoveChat: (id: string) => void;
  onSelectMode: (mode: AppModeId) => void;
  onNewChat: () => void;
  onDuplicateChat: () => void;
  onToggleScreenShare: () => void;
  onOpenModelMenu: () => void;
  onCopy: () => void;
  onOpenTeleprompter: () => void;
  onStop: () => void;
  onCollapse: () => void;
  onOpenUpdate: () => void;
}

/**
 * `memo` со срезами вместо целых API-объектов: `App` рендерится на каждый кадр
 * стрима, а шапке из него нужны только вкладки, флаги и стабильные колбэки.
 */
export const AppHeader = memo(function AppHeader({
  recorderState,
  hotkeys,
  update,
  chats,
  activeId,
  streaming,
  unread,
  mode,
  canCopy,
  canTeleprompt,
  contextUsage,
  screenShareVisible,
  onSelectChat,
  onRemoveChat,
  onSelectMode,
  onNewChat,
  onDuplicateChat,
  onToggleScreenShare,
  onOpenModelMenu,
  onCopy,
  onOpenTeleprompter,
  onStop,
  onCollapse,
  onOpenUpdate,
}: AppHeaderProps) {
  const { t } = useTranslation();
  const dockItems = useMemo<ToolbarDockItem[]>(
    () => [
      {
        id: "copy",
        label: t("hud.header.copyLastAnswer"),
        icon: <Copy />,
        disabled: !canCopy,
        onClick: onCopy,
      },
      {
        id: "teleprompter",
        label: t("hud.header.teleprompter"),
        icon: <ScrollText />,
        shortcut: formatCombo(effectiveCombo(hotkeys, "teleprompter")),
        disabled: !canTeleprompt,
        onClick: onOpenTeleprompter,
      },
      {
        id: "models",
        label: t("hud.header.models"),
        icon: <Cpu />,
        shortcut: formatCombo(effectiveCombo(hotkeys, "model_menu")),
        onClick: onOpenModelMenu,
      },
      {
        id: "screen-share",
        label: screenShareVisible
          ? t("hud.header.screenShareVisible")
          : t("hud.header.screenShareHidden"),
        icon: screenShareVisible ? <Eye /> : <EyeOff />,
        iconClass: screenShareVisible ? "text-primary hover:text-primary/85" : undefined,
        onClick: onToggleScreenShare,
      },
      {
        id: "hotkeys",
        label: t("hud.header.hotkeys"),
        element: <HotkeysPopover hotkeys={hotkeys} triggerClass={DOCK_BUTTON_CLASS} />,
      },
      ...(update
        ? [
            {
              id: "update",
              label: update.busy
                ? t("updates.updating", { version: update.version })
                : t("updates.available", { version: update.version }),
              icon: <ArrowDownCircle className={cn(update.busy && "animate-pulse")} />,
              iconClass: "text-primary hover:text-primary/85",
              onClick: onOpenUpdate,
            },
          ]
        : []),
      {
        id: "mini",
        label: t("hud.header.collapse"),
        icon: <Minus />,
        shortcut: formatCombo(effectiveCombo(hotkeys, "toggle_window")),
        onClick: onCollapse,
      },
      { id: "stop", label: t("hud.header.stop"), icon: <Square />, onClick: onStop },
    ],
    [
      t,
      hotkeys,
      update,
      canCopy,
      canTeleprompt,
      screenShareVisible,
      onCopy,
      onOpenTeleprompter,
      onOpenModelMenu,
      onToggleScreenShare,
      onOpenUpdate,
      onCollapse,
      onStop,
    ],
  );
  return (
    <StatusBar
      state={recorderState}
      contextUsage={contextUsage}
      dockItems={dockItems}
      modeSwitch={
        <ModeSwitch
          mode={mode}
          combo={formatCombo(effectiveCombo(hotkeys, "toggle_mode"))}
          onSelect={onSelectMode}
        />
      }
      tabs={
        <ChatTabs
          chats={chats}
          activeId={activeId}
          streaming={streaming}
          unread={unread}
          onSelect={onSelectChat}
          onRemove={onRemoveChat}
          onNew={onNewChat}
          onDuplicate={onDuplicateChat}
          duplicateCombo={effectiveCombo(hotkeys, "duplicate_chat")}
        />
      }
    />
  );
});
