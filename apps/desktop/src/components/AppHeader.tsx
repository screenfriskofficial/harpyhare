import {
  ArrowDownCircle,
  Cpu,
  Eye,
  EyeOff,
  Keyboard,
  LogOut,
  Minus,
  ScrollText,
} from "lucide-react";
import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChatTabs } from "@/components/ChatTabs";
import { HotkeysReference } from "@/components/HotkeysReference";
import { ModeSwitch } from "@/components/ModeSwitch";
import { StatusBar } from "@/components/StatusBar";
import type { ToolbarDockItem } from "@/components/ToolbarDock";
import type { HotkeyBinding, RecorderState } from "@/ipc/types";
import type { Chat } from "@/lib/chats";
import { effectiveCombo, formatCombo } from "@/lib/hotkeys";
import type { AppModeId } from "@/lib/modes";
import { cn } from "@/lib/utils";

/** `primary` marks states the user must notice: the window is capturable, an update is waiting. */
const INDICATOR_ICON_CLASS =
  "text-primary group-hover:text-primary group-focus-visible:text-primary";

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
  canTeleprompt: boolean;
  screenShareVisible: boolean;
  onSelectChat: (id: string) => void;
  onRemoveChat: (id: string) => void;
  onSelectMode: (mode: AppModeId) => void;
  onNewChat: () => void;
  onDuplicateChat: () => void;
  onToggleScreenShare: () => void;
  onOpenModelMenu: () => void;
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
  canTeleprompt,
  screenShareVisible,
  onSelectChat,
  onRemoveChat,
  onSelectMode,
  onNewChat,
  onDuplicateChat,
  onToggleScreenShare,
  onOpenModelMenu,
  onOpenTeleprompter,
  onStop,
  onCollapse,
  onOpenUpdate,
}: AppHeaderProps) {
  const { t } = useTranslation();
  const dockSections = useMemo<ToolbarDockItem[][]>(
    () => [
      update
        ? [
            {
              id: "update",
              label: update.busy
                ? t("updates.updating", { version: update.version })
                : t("updates.available", { version: update.version }),
              icon: <ArrowDownCircle className={cn(update.busy && "animate-pulse")} />,
              iconClass: INDICATOR_ICON_CLASS,
              onClick: onOpenUpdate,
            },
          ]
        : [],
      [
        {
          id: "models",
          label: t("hud.header.models"),
          icon: <Cpu />,
          shortcut: formatCombo(effectiveCombo(hotkeys, "model_menu")),
          onClick: onOpenModelMenu,
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
          id: "screen-share",
          label: screenShareVisible
            ? t("hud.header.screenShareVisible")
            : t("hud.header.screenShareHidden"),
          icon: screenShareVisible ? <Eye /> : <EyeOff />,
          iconClass: screenShareVisible ? INDICATOR_ICON_CLASS : undefined,
          onClick: onToggleScreenShare,
        },
      ],
      [
        {
          id: "hotkeys",
          label: t("hud.header.hotkeys"),
          icon: <Keyboard />,
          panel: <HotkeysReference hotkeys={hotkeys} />,
        },
        {
          id: "mini",
          label: t("hud.header.collapse"),
          icon: <Minus />,
          shortcut: formatCombo(effectiveCombo(hotkeys, "toggle_window")),
          onClick: onCollapse,
        },
        { id: "stop", label: t("hud.header.stop"), icon: <LogOut />, onClick: onStop },
      ],
    ],
    [
      t,
      hotkeys,
      update,
      canTeleprompt,
      screenShareVisible,
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
      dockSections={dockSections}
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
