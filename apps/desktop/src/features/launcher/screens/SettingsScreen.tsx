import type { ReactNode } from "react";
import type { SectionProps } from "../contract";
import { ScreenShell } from "../ScreenShell";
import { ApiKeysSection } from "../sections/ApiKeysSection";
import { AppearanceSection } from "../sections/AppearanceSection";
import { BehaviorSection } from "../sections/BehaviorSection";
import { HotkeysSection } from "../sections/HotkeysSection";
import { QuickActionsSection } from "../sections/QuickActionsSection";
import { SttSection } from "../sections/SttSection";
import { WindowSection } from "../sections/WindowSection";
import { settingsTabMeta, type SettingsTabId } from "../settings-tabs";
import { SettingsTabsRail } from "../SettingsTabsRail";

type SettingsScreenProps = SectionProps & {
  tab: SettingsTabId;
  onRedeem: (code: string) => Promise<string | null>;
  onUnlink: () => Promise<void>;
  onTabChange: (tab: SettingsTabId) => void;
};

export function SettingsScreen({
  draft,
  set,
  tab,
  onRedeem,
  onUnlink,
  onTabChange,
}: SettingsScreenProps) {
  const sections: Record<SettingsTabId, ReactNode> = {
    access: <ApiKeysSection draft={draft} set={set} onRedeem={onRedeem} onUnlink={onUnlink} />,
    speech: <SttSection draft={draft} set={set} />,
    hotkeys: <HotkeysSection draft={draft} set={set} />,
    window: <WindowSection draft={draft} set={set} />,
    "quick-actions": <QuickActionsSection draft={draft} set={set} />,
    behavior: <BehaviorSection draft={draft} set={set} />,
    appearance: <AppearanceSection draft={draft} set={set} />,
  };

  return (
    <ScreenShell screen="settings">
      <div className="flex min-w-0 gap-3 min-[900px]:gap-4">
        <SettingsTabsRail active={tab} onSelect={onTabChange} />
        <div
          key={tab}
          className="flex min-w-0 flex-1 animate-in flex-col gap-3 duration-150 fade-in-0 slide-in-from-bottom-1 motion-reduce:animate-none"
        >
          <p className="text-caption text-muted-foreground">{settingsTabMeta(tab).description}</p>
          {sections[tab]}
        </div>
      </div>
    </ScreenShell>
  );
}
