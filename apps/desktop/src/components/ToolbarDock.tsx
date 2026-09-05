import { Menu } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/IconButton";
import { ICON_CLUSTER_CLASS } from "@/components/IconCluster";
import { ShortcutTooltip } from "@/components/ShortcutTooltip";
import { insideFloatingLayer, keyboardLayerOpen } from "@/lib/portalled-layers";
import { cn } from "@/lib/utils";

export interface ToolbarDockItem {
  id: string;
  label: string;
  icon?: ReactNode;
  element?: ReactNode;
  shortcut?: string;
  iconClass?: string;
  disabled?: boolean;
  onClick?: () => void;
}

export interface ToolbarDockProps {
  items: ToolbarDockItem[];
  leading?: ReactNode;
}

export const DOCK_BUTTON_CLASS = "rounded-full hover:bg-transparent";

const ESCAPE_KEY = "Escape";

const DOCK_TOOLTIP_SIDE = "left";

function DockTooltip({
  label,
  shortcut,
  children,
}: {
  label: string;
  shortcut?: string;
  children: ReactNode;
}) {
  return (
    <ShortcutTooltip label={label} shortcut={shortcut} side={DOCK_TOOLTIP_SIDE}>
      {children}
    </ShortcutTooltip>
  );
}

/** `memo`: `items` собирается в `useMemo` у родителя, иначе мемоизация не даёт ничего. */
export const ToolbarDock = memo(function ToolbarDock({ items, leading }: ToolbarDockProps) {
  const { t } = useTranslation();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const toggleLabel = open ? t("hud.header.dockClose") : t("hud.header.dockOpen");

  const closeAndRestoreFocus = useCallback(() => {
    setOpen(false);
    toggleRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (insideFloatingLayer(e.target)) return;
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== ESCAPE_KEY) return;
      if (e.defaultPrevented) return;
      if (keyboardLayerOpen()) return;
      e.preventDefault();
      closeAndRestoreFocus();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, closeAndRestoreFocus]);

  return (
    <div ref={wrapperRef} className="relative shrink-0">
      <span data-no-drag className={ICON_CLUSTER_CLASS}>
        {leading}
        {leading !== undefined && (
          <span className="mx-0.5 h-4 w-px shrink-0 bg-border" aria-hidden />
        )}
        <DockTooltip label={toggleLabel}>
          <IconButton
            ref={toggleRef}
            title=""
            aria-label={toggleLabel}
            aria-expanded={open}
            className={DOCK_BUTTON_CLASS}
            onClick={() => {
              setOpen((o) => !o);
            }}
          >
            <Menu />
          </IconButton>
        </DockTooltip>
      </span>
      {open && (
        <div
          data-no-drag
          className="absolute top-full right-0 z-30 mt-1.5 flex origin-top animate-in flex-col items-center gap-0.5 rounded-xl bg-background p-0.5 shadow-pop ring-1 ring-border duration-200 fade-in-0 zoom-in-95 [animation-timing-function:cubic-bezier(0.34,1.56,0.64,1)] ring-inset slide-in-from-top-1 motion-reduce:animate-none"
        >
          {items.map((item) => (
            <DockTooltip key={item.id} label={item.label} shortcut={item.shortcut}>
              <span className="relative inline-flex shrink-0">
                {item.element ?? (
                  <IconButton
                    title=""
                    aria-label={item.label}
                    className={cn(DOCK_BUTTON_CLASS, item.iconClass)}
                    disabled={item.disabled}
                    onClick={() => {
                      item.onClick?.();
                      closeAndRestoreFocus();
                    }}
                  >
                    {item.icon}
                  </IconButton>
                )}
              </span>
            </DockTooltip>
          ))}
        </div>
      )}
    </div>
  );
});
