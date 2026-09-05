import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { SETTINGS_TABS, settingsTabLabel, type SettingsTabId } from "./settings-tabs";

interface SettingsTabsRailProps {
  active: SettingsTabId;
  onSelect: (id: SettingsTabId) => void;
}

function SettingsTabButton({
  id,
  label,
  icon: Icon,
  active,
  onSelect,
}: {
  id: SettingsTabId;
  label: string;
  icon: (props: { className?: string }) => React.ReactNode;
  active: boolean;
  onSelect: (id: SettingsTabId) => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      title={label}
      onClick={() => {
        onSelect(id);
      }}
      className={cn(
        "relative flex items-center justify-center gap-2 rounded-md px-0 py-1.5 text-left text-body whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 min-[900px]:justify-start min-[900px]:px-2",
        active
          ? "bg-surface-active text-foreground"
          : "text-muted-foreground hover:bg-surface hover:text-foreground active:bg-surface-active",
      )}
    >
      {active && (
        <span
          className="absolute top-1/2 left-0 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary"
          aria-hidden
        />
      )}
      <Icon className="size-4 shrink-0" />
      <span className="hidden truncate min-[900px]:inline">{label}</span>
    </button>
  );
}

export function SettingsTabsRail({ active, onSelect }: SettingsTabsRailProps) {
  useTranslation();
  return (
    <div
      role="tablist"
      aria-orientation="vertical"
      className="sticky top-0 flex w-9 shrink-0 flex-col gap-0.5 self-start min-[900px]:w-30"
    >
      {SETTINGS_TABS.map((tab) => (
        <SettingsTabButton
          key={tab.id}
          id={tab.id}
          label={settingsTabLabel(tab.id)}
          icon={tab.icon}
          active={active === tab.id}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
