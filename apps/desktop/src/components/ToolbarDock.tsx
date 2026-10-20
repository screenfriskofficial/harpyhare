import { Menu } from "lucide-react";
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/IconButton";
import { ICON_CLUSTER_CLASS } from "@/components/IconCluster";
import { ShortcutTooltip } from "@/components/ShortcutTooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { insideFloatingLayer, keyboardLayerOpen } from "@/lib/portalled-layers";
import { cn } from "@/lib/utils";

export interface ToolbarDockItem {
  id: string;
  label: string;
  icon: ReactNode;
  shortcut?: string;
  /** Colours the icon only: `primary` is an indicator colour and never goes on text. */
  iconClass?: string;
  disabled?: boolean;
  /** Runs the action and closes the menu. */
  onClick?: () => void;
  /** Opens beside the row instead of running an action; the menu stays open underneath. */
  panel?: ReactNode;
}

export interface ToolbarDockProps {
  /** Groups of the menu, split by a hairline; empty groups are skipped. */
  sections: ToolbarDockItem[][];
  leading?: ReactNode;
}

export const DOCK_BUTTON_CLASS = "rounded-full hover:bg-transparent";

const ESCAPE_KEY = "Escape";
const NEXT_ITEM_KEY = "ArrowDown";
const PREVIOUS_ITEM_KEY = "ArrowUp";
const FIRST_ITEM_KEY = "Home";
const LAST_ITEM_KEY = "End";
const ENABLED_ITEM_SELECTOR = "[role='menuitem']:not(:disabled)";

const DOCK_TOOLTIP_SIDE = "left";
const PANEL_SIDE = "left";
const PANEL_ALIGN = "start";
const PANEL_COLLISION_PADDING_PX = 8;

// The panel carries `data-no-drag`: React bubbles its mousedown out of the portal up
// to the header, and a press on the panel's text would otherwise drag the window.
const PANEL_CLASS =
  "max-h-(--radix-popover-content-available-height) w-80 max-w-(--radix-popover-content-available-width) overflow-y-auto p-3";

const MENU_CLASS =
  "absolute top-full right-0 z-30 mt-1.5 flex w-max min-w-44 origin-top-right animate-in flex-col rounded-lg border bg-popover p-1 text-popover-foreground shadow-pop duration-150 fade-in-0 zoom-in-95 slide-in-from-top-1 motion-reduce:animate-none";

const MENU_ITEM_CLASS =
  "group flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-body text-foreground/90 transition-colors outline-none hover:bg-surface hover:text-foreground focus-visible:bg-surface focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-40 data-[state=open]:bg-surface data-[state=open]:text-foreground";

const MENU_ICON_CLASS =
  "flex size-3.5 shrink-0 items-center justify-center text-muted-foreground group-hover:text-foreground group-focus-visible:text-foreground [&_svg]:size-3.5";

function enabledItems(menu: HTMLElement): HTMLElement[] {
  return [...menu.querySelectorAll<HTMLElement>(ENABLED_ITEM_SELECTOR)];
}

/** Arrow keys walk the enabled items with wrap-around, as in a native menu. */
function moveFocus(menu: HTMLElement, key: string): boolean {
  const items = enabledItems(menu);
  if (items.length === 0) return false;
  const current = items.findIndex((item) => item === document.activeElement);
  const last = items.length - 1;
  let next: number;
  if (key === FIRST_ITEM_KEY) next = 0;
  else if (key === LAST_ITEM_KEY) next = last;
  else if (key === NEXT_ITEM_KEY) next = current < 0 || current === last ? 0 : current + 1;
  else if (key === PREVIOUS_ITEM_KEY) next = current <= 0 ? last : current - 1;
  else return false;
  items[next]?.focus();
  return true;
}

function DockMenuItemContent({ item }: { item: ToolbarDockItem }) {
  return (
    <>
      <span className={cn(MENU_ICON_CLASS, item.iconClass)} aria-hidden>
        {item.icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.shortcut !== undefined && item.shortcut !== "" && (
        <span className="shrink-0 pl-4 text-hint text-muted-foreground">{item.shortcut}</span>
      )}
    </>
  );
}

function DockMenuItem({ item, onSelect }: { item: ToolbarDockItem; onSelect: () => void }) {
  if (item.panel !== undefined) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            role="menuitem"
            aria-haspopup="dialog"
            disabled={item.disabled}
            className={MENU_ITEM_CLASS}
          >
            <DockMenuItemContent item={item} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          data-no-drag
          side={PANEL_SIDE}
          align={PANEL_ALIGN}
          collisionPadding={PANEL_COLLISION_PADDING_PX}
          className={PANEL_CLASS}
        >
          {item.panel}
        </PopoverContent>
      </Popover>
    );
  }
  return (
    <button
      type="button"
      role="menuitem"
      disabled={item.disabled}
      className={MENU_ITEM_CLASS}
      onClick={onSelect}
    >
      <DockMenuItemContent item={item} />
    </button>
  );
}

/** `memo`: `sections` is built in a parent `useMemo`, otherwise memoisation buys nothing. */
export const ToolbarDock = memo(function ToolbarDock({ sections, leading }: ToolbarDockProps) {
  const { t } = useTranslation();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // A keyboard-opened menu takes focus onto its first item; a mouse-opened one leaves it alone.
  const [focusOnOpen, setFocusOnOpen] = useState(false);
  const toggleLabel = open ? t("hud.header.dockClose") : t("hud.header.dockOpen");
  const visibleSections = sections.filter((section) => section.length > 0);

  const closeAndRestoreFocus = useCallback(() => {
    setOpen(false);
    toggleRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open || !focusOnOpen || !menuRef.current) return;
    enabledItems(menuRef.current)[0]?.focus();
  }, [open, focusOnOpen]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (insideFloatingLayer(e.target)) return;
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
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

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Keys pressed inside a row's portalled panel bubble here through the React tree.
    if (!(e.target instanceof Node) || !e.currentTarget.contains(e.target)) return;
    if (moveFocus(e.currentTarget, e.key)) e.preventDefault();
  };

  return (
    <div ref={wrapperRef} className="relative shrink-0">
      <span data-no-drag className={ICON_CLUSTER_CLASS}>
        {leading}
        {leading !== undefined && (
          <span className="mx-0.5 h-4 w-px shrink-0 bg-border" aria-hidden />
        )}
        <ShortcutTooltip label={toggleLabel} side={DOCK_TOOLTIP_SIDE}>
          <IconButton
            ref={toggleRef}
            title=""
            aria-label={toggleLabel}
            aria-haspopup="menu"
            aria-expanded={open}
            className={cn(DOCK_BUTTON_CLASS, open && "text-foreground")}
            onClick={(e) => {
              // `detail` is 0 for a click synthesised from Enter or Space.
              setFocusOnOpen(e.detail === 0);
              setOpen((o) => !o);
            }}
          >
            <Menu />
          </IconButton>
        </ShortcutTooltip>
      </span>
      {open && (
        <div
          ref={menuRef}
          data-no-drag
          role="menu"
          aria-label={t("hud.header.dockOpen")}
          className={MENU_CLASS}
          onKeyDown={onMenuKeyDown}
        >
          {visibleSections.map((section, index) => (
            <Fragment key={section[0]?.id}>
              {index > 0 && <div role="separator" className="-mx-1 my-1 h-px bg-border" />}
              {section.map((item) => (
                <DockMenuItem
                  key={item.id}
                  item={item}
                  onSelect={() => {
                    item.onClick?.();
                    closeAndRestoreFocus();
                  }}
                />
              ))}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
});
