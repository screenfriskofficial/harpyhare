import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { screenGroup, screenLabel, SCREEN_GROUPS, type ScreenId } from "./screens";

export interface SidebarNotice {
  screen: ScreenId;
  label: string;
  kind: "blocker" | "info";
}

interface SidebarProps {
  active: ScreenId;
  notices: SidebarNotice[];
  onSelect: (id: ScreenId) => void;
}

function itemTitle(label: string, notice: SidebarNotice | undefined): string {
  return notice === undefined ? label : `${label} — ${notice.label}`;
}

function SidebarItem({
  id,
  label,
  icon: Icon,
  active,
  notice,
  onSelect,
}: {
  id: ScreenId;
  label: string;
  icon: (props: { className?: string }) => React.ReactNode;
  active: boolean;
  notice: SidebarNotice | undefined;
  onSelect: (id: ScreenId) => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      title={itemTitle(label, notice)}
      onClick={() => {
        onSelect(id);
      }}
      className={cn(
        "group relative flex items-center justify-center rounded-md px-0 py-2 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
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
      {notice !== undefined && (
        <span
          className={cn(
            "absolute top-1 right-1 size-1.5 rounded-full",
            notice.kind === "blocker" ? "bg-destructive" : "bg-primary",
          )}
          aria-hidden
        />
      )}
    </button>
  );
}

export function Sidebar({ active, notices, onSelect }: SidebarProps) {
  useTranslation();
  return (
    <div
      role="tablist"
      aria-orientation="vertical"
      className="no-scrollbar flex w-10 shrink-0 flex-col gap-4 overflow-y-auto"
    >
      {SCREEN_GROUPS.map((group) => (
        <div key={group} className={cn("flex flex-col gap-0.5", group === "system" && "mt-auto")}>
          {screenGroup(group).map((screen) => (
            <SidebarItem
              key={screen.id}
              id={screen.id}
              label={screenLabel(screen.id)}
              icon={screen.icon}
              active={active === screen.id}
              notice={notices.find((n) => n.screen === screen.id)}
              onSelect={onSelect}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
