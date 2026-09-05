import { ChevronsUpDown } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { ThinkingOrb, type OrbState } from "thinking-orbs";
import { cn } from "@/lib/cn";

const BAR_HEIGHTS_PX = [8, 14, 10, 17, 9];
const BAR_STAGGER_S = 0.12;

/** Размер орба в строке шапки — тот же пресет, что у приложения (`ORB_SIZE_INLINE`). */
export const ORB_SIZE_INLINE = 20;
export const ORB_STATE_IDLE: OrbState = "breathing";

/** Тот же орб, что в приложении: библиотека `thinking-orbs`, тёмная тема, 20px. */
export function AppOrb({ state }: { state: OrbState }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center self-center"
      style={{ width: ORB_SIZE_INLINE, height: ORB_SIZE_INLINE }}
      aria-hidden
    >
      <ThinkingOrb state={state} size={20} theme="dark" />
    </span>
  );
}

export function AppEqBars({ animated, barClass }: { animated: boolean; barClass: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-[2.5px]" aria-hidden>
      {BAR_HEIGHTS_PX.map((height, index) => (
        <span
          key={index}
          className={cn("w-[2.5px] rounded-full", barClass, animated && "eq-bar")}
          style={{
            height: `${height}px`,
            animationDelay: animated ? `${index * BAR_STAGGER_S}s` : undefined,
          }}
        />
      ))}
    </span>
  );
}

/** Пилюля группы иконочных кнопок: док действий и кластер действий сообщения. */
export const ICON_CLUSTER_CLASS =
  "flex items-center gap-0.5 rounded-full bg-app-bg p-0.5 ring-1 ring-app-border ring-inset";
export const ICON_CLUSTER_BUTTON_CLASS = "rounded-full hover:bg-app-surface";
export const ICON_CLUSTER_BUTTON_SIZE_CLASS = "size-6 [&_svg]:size-3.5";
/** Кнопки внутри дока: без своей заливки, поверхность даёт пилюля. */
export const DOCK_BUTTON_CLASS = "rounded-full hover:bg-transparent";
/** Непрозрачный чип поверх ленты («↓ Вниз»). */
export const FLOATING_CHIP_CLASS = "border border-app-border bg-app-popover shadow-app-pop";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode };

/** Иконочная кнопка приложения: `size-7`, скруглённые углы, приглушённая до наведения. */
export function AppIconButton({ className, children, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-md text-app-muted transition-colors outline-none hover:bg-app-surface hover:text-app-fg focus-visible:ring-2 focus-visible:ring-app-ring/60 active:bg-app-surface-active disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function AppPrimaryButton({ className, children, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md bg-app-primary px-3 text-app-caption font-medium text-app-primary-fg shadow-app-btn transition-colors hover:bg-app-primary/90 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function AppGhostButton({ className, children, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 text-app-caption text-app-muted transition-colors hover:bg-app-surface hover:text-app-fg disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/** Чип сочетания клавиш — как `ComboChip` в HUD: моно-текст на поверхности с хайрлайном. */
export function ComboChip({ combo, className }: { combo: string; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 items-center justify-center gap-0.5 rounded-sm bg-app-surface px-1.5 font-mono text-app-caption whitespace-nowrap text-app-fg/90 ring-1 ring-app-border ring-inset",
        className,
      )}
    >
      {combo}
    </kbd>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center gap-0.5 rounded-md border border-app-border bg-app-surface px-2 py-1 font-mono text-app-body text-app-fg/90">
      {children}
    </kbd>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("text-app-hint font-medium text-app-fg/55", className)}>{children}</span>
  );
}

export function SettingGroup({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl bg-app-card ring-1 ring-app-border ring-inset">
      <header className="px-4 pt-3 pb-2.5">
        <h3 className="text-app-body font-medium text-app-fg">{title}</h3>
        {description !== undefined && (
          <p className="mt-0.5 text-app-caption text-app-muted">{description}</p>
        )}
      </header>
      <div className="divide-y divide-app-border border-t border-app-border">{children}</div>
    </section>
  );
}

export function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_9rem] items-center gap-x-4 px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_14rem] sm:gap-x-5">
      <div className="min-w-0">
        <span className="text-app-body text-app-fg">{label}</span>
        {hint !== undefined && <p className="mt-0.5 text-app-caption text-app-muted">{hint}</p>}
      </div>
      <div className="flex min-w-0 items-center justify-end">{children}</div>
    </div>
  );
}

export function AppSwitch({
  checked,
  ariaLabel,
  disabled = false,
  onChange,
}: {
  checked: boolean;
  ariaLabel: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => {
        onChange(!checked);
      }}
      className={cn(
        "inline-flex h-[18px] w-8 shrink-0 items-center rounded-full p-[2px] transition-colors disabled:opacity-50",
        checked ? "bg-app-primary" : "bg-app-surface-active",
      )}
    >
      <span
        className={cn(
          "size-[14px] rounded-full bg-app-fg transition-transform",
          checked ? "translate-x-[14px]" : "translate-x-0",
        )}
      />
    </button>
  );
}

export function CycleSelect({
  value,
  options,
  ariaLabel,
  onChange,
}: {
  value: string;
  options: readonly string[];
  ariaLabel: string;
  onChange: (value: string) => void;
}) {
  const next = () => {
    const index = options.indexOf(value);
    const following = options[(index + 1) % options.length];
    if (following !== undefined) onChange(following);
  };
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={next}
      className="flex h-7 w-full min-w-0 items-center justify-between gap-1.5 rounded-md border border-app-border bg-app-surface px-2 text-app-caption text-app-fg transition-colors hover:bg-app-surface-active"
    >
      <span className="min-w-0 truncate">{value}</span>
      <ChevronsUpDown className="size-3 shrink-0 opacity-50" />
    </button>
  );
}

export function AppSlider({
  value,
  min,
  max,
  step,
  ariaLabel,
  readout,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  ariaLabel: string;
  readout: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex w-full items-center gap-3">
      <input
        type="range"
        className="app-range min-w-0 flex-1"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => {
          onChange(Number(e.target.value));
        }}
      />
      <span className="w-12 shrink-0 text-right font-mono text-app-caption text-app-muted tabular-nums">
        {readout}
      </span>
    </div>
  );
}
