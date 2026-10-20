import { Check } from "lucide-react";
import { useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { SectionLabel } from "@/components/SectionLabel";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useComposerPopoverClose } from "@/hooks/useComposerPopoverClose";
import type { Chat, ChatPatch } from "@/lib/chats";
import {
  EFFORT_METER_BARS,
  effortChoiceLabel,
  effortMenu,
  effortPatch,
  effortRank,
  type EffortChoice,
  type EffortMenu,
} from "@/lib/effort";
import type { ModelInfo } from "@/lib/models";
import { cn } from "@/lib/utils";

export interface EffortPickerProps {
  chat: Chat;
  /** The chat's model as the pickers know it; `undefined` for a saved id outside the list. */
  model: ModelInfo | undefined;
  onPatch: (chatId: string, patch: ChatPatch) => void;
  /** Same contract as the params popover: see `useComposerPopoverClose`. */
  onClosed: (pressedOutside: Element | null) => void;
}

/** The meter's geometry, in a 16-unit box: bars grow left to right, bottom-aligned. */
const METER_BAR_WIDTH = 2;
const METER_BAR_STEP = 3;
const METER_FIRST_BAR_X = 1.5;
const METER_BASELINE_Y = 14.5;
const METER_SHORTEST_BAR = 3;
const METER_BAR_GROWTH = 2.5;
/** Bars above the level — still drawn, so the meter keeps one shape for every choice. */
const METER_EMPTY_OPACITY = 0.3;

const RADIO_SELECTOR = "[role='radio']";

const MAX_LEVEL = "max";

function filledBars(choice: EffortChoice): number {
  if (choice === "off") return 0;
  if (choice === "on") return EFFORT_METER_BARS;
  return effortRank(choice);
}

/**
 * Signal-strength bars: a level fills as many as its rank on the ladder,
 * extended thinking fills them all, «off» is crossed out. One fixed glyph for
 * every state, so the toolbar never changes width with the choice.
 */
function EffortMeter({ choice, className }: { choice: EffortChoice; className?: string }) {
  const filled = filledBars(choice);
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={cn("size-4", className)} aria-hidden>
      {Array.from({ length: EFFORT_METER_BARS }, (_, i) => {
        const height = METER_SHORTEST_BAR + i * METER_BAR_GROWTH;
        return (
          <rect
            key={i}
            x={METER_FIRST_BAR_X + i * METER_BAR_STEP}
            y={METER_BASELINE_Y - height}
            width={METER_BAR_WIDTH}
            height={height}
            rx={0.5}
            opacity={i < filled ? 1 : METER_EMPTY_OPACITY}
          />
        );
      })}
      {choice === "off" && (
        <line
          x1={2}
          y1={14}
          x2={14}
          y2={2}
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

/** Arrow keys walk the choices, as in any radio group; Enter or Space picks. */
function moveRadioFocus(event: KeyboardEvent<HTMLDivElement>) {
  const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
  if (step === undefined) return;
  event.preventDefault();
  const radios = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(RADIO_SELECTOR));
  const from = radios.findIndex((r) => r === document.activeElement);
  radios[(from + step + radios.length) % radios.length]?.focus();
}

/** claude.ai's «Extended — Always uses deep reasoning»: the whole menu of a budget model. */
function ExtendedSwitch({
  menu,
  onChoose,
}: {
  menu: EffortMenu;
  onChoose: (choice: EffortChoice) => void;
}) {
  const { t } = useTranslation();
  const label = effortChoiceLabel("on");
  return (
    <label className="flex items-center gap-3 rounded-sm px-2 py-1.5">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-body">{label}</span>
        <span className="text-hint text-muted-foreground">{t("hud.effort.extendedHint")}</span>
      </span>
      <Switch
        aria-label={label}
        checked={menu.current === "on"}
        onCheckedChange={(checked) => {
          onChoose(checked ? "on" : "off");
        }}
      />
    </label>
  );
}

function LevelList({
  menu,
  onChoose,
  listRef,
}: {
  menu: EffortMenu;
  onChoose: (choice: EffortChoice) => void;
  listRef: RefObject<HTMLDivElement | null>;
}) {
  const { t } = useTranslation();
  return (
    <>
      <p className="px-2 pb-1.5 text-hint text-muted-foreground">{t("hud.effort.hint")}</p>
      <div
        ref={listRef}
        role="radiogroup"
        aria-label={t("hud.effort.title")}
        className="flex flex-col"
        onKeyDown={moveRadioFocus}
      >
        {menu.choices.map((choice) => {
          const checked = choice === menu.current;
          return (
            <button
              key={choice}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-body outline-hidden hover:bg-surface-active focus-visible:bg-surface-active"
              onClick={() => {
                onChoose(choice);
              }}
            >
              <EffortMeter choice={choice} className="text-muted-foreground" />
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className="truncate">{effortChoiceLabel(choice)}</span>
                {choice === menu.defaultLevel && (
                  <span className="shrink-0 rounded-sm bg-surface px-1 text-hint text-muted-foreground">
                    {t("hud.effort.default")}
                  </span>
                )}
                {choice === MAX_LEVEL && (
                  <span className="shrink-0 text-hint text-muted-foreground">
                    {t("hud.effort.maxWarning")}
                  </span>
                )}
              </span>
              {checked && <Check className="size-3.5 shrink-0" aria-hidden />}
            </button>
          );
        })}
      </div>
    </>
  );
}

/**
 * The chat's reasoning in one control, right in the composer's toolbar, shaped
 * like claude.ai's: the levels the model takes, or the extended-thinking
 * switch of a budget model. Lives beside the params popover rather than inside
 * it because it is the one request setting worth changing between two
 * questions of the same interview.
 */
export function EffortPicker(props: EffortPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const closeReport = useComposerPopoverClose(props.onClosed);
  const menu = effortMenu(props.model, props.chat);
  const label = menu.disabled
    ? t("hud.effort.unavailable")
    : t("hud.effort.button", { level: effortChoiceLabel(menu.current) });
  const choose = (choice: EffortChoice) => {
    props.onPatch(props.chat.id, effortPatch(choice));
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* The title sits on a wrapper: a disabled button takes no pointer events,
          and the hover has to explain why it is grey. */}
      <span className="inline-flex" title={label}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon-compact" disabled={menu.disabled} aria-label={label}>
            <EffortMeter choice={menu.current} />
          </Button>
        </PopoverTrigger>
      </span>
      <PopoverContent
        side="top"
        align="start"
        className="w-64 p-1"
        onOpenAutoFocus={(event) => {
          // Land on the current choice, so the arrows start from where the chat is.
          event.preventDefault();
          listRef.current?.querySelector<HTMLElement>("[aria-checked='true']")?.focus();
        }}
        onInteractOutside={closeReport.onInteractOutside}
        onCloseAutoFocus={closeReport.onCloseAutoFocus}
      >
        <SectionLabel className="block px-2 pt-1 pb-1.5">{t("hud.effort.title")}</SectionLabel>
        {menu.toggle ? (
          <ExtendedSwitch menu={menu} onChoose={choose} />
        ) : (
          <LevelList menu={menu} onChoose={choose} listRef={listRef} />
        )}
      </PopoverContent>
    </Popover>
  );
}
