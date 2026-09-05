import { useCallback, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SectionLabel } from "@/components/SectionLabel";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

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
    <section className="flex flex-col gap-1.5">
      <header className="flex flex-col gap-0.5 px-1">
        <SectionLabel>{title}</SectionLabel>
        {description !== undefined && (
          <p className="text-caption text-muted-foreground/90">{description}</p>
        )}
      </header>
      <div className="divide-y divide-border overflow-hidden rounded-lg bg-card shadow-raise ring-1 ring-border ring-inset">
        {children}
      </div>
    </section>
  );
}

export function SettingRow({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-9 grid-cols-[minmax(0,1fr)_14rem] items-center gap-x-4 px-3 py-2">
      <div className="min-w-0">
        <Label htmlFor={htmlFor} className="text-body font-normal text-foreground">
          {label}
        </Label>
        {hint !== undefined && <p className="mt-0.5 text-caption text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex min-w-0 items-center justify-end">{children}</div>
    </div>
  );
}

export function SettingBlock({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2.5">
      <div className="min-w-0">
        <span className="text-body text-foreground">{label}</span>
        {hint !== undefined && <p className="mt-0.5 text-caption text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

export function SettingSelect({
  value,
  ariaLabel,
  disabled,
  onValueChange,
  children,
}: {
  value: string;
  ariaLabel: string;
  disabled?: boolean;
  onValueChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <Select value={value} disabled={disabled} onValueChange={onValueChange}>
      <SelectTrigger size="sm" aria-label={ariaLabel} className="w-full min-w-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">{children}</SelectContent>
    </Select>
  );
}

export function SettingSwitch({
  checked,
  ariaLabel,
  disabled,
  onCheckedChange,
}: {
  checked: boolean;
  ariaLabel: string;
  disabled?: boolean;
  onCheckedChange: (value: boolean) => void;
}) {
  return (
    <Switch
      checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
    />
  );
}

const READOUT_DISPLAY_PRECISION = 3;

function stepDecimals(step: number): number {
  const text = String(step);
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

function roundToStepPrecision(value: number, step: number): number {
  return Number(value.toFixed(stepDecimals(step)));
}

function clampToRange(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readoutDisplayText(value: number, displayScale: number): string {
  return String(Number((value * displayScale).toFixed(READOUT_DISPLAY_PRECISION)));
}

function parseTypedNumber(text: string): number | null {
  const normalized = text.trim().replace(",", ".");
  if (normalized === "") return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function SliderReadout({
  value,
  min,
  max,
  step,
  displayScale,
  ariaLabel,
  readout,
  disabled,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  displayScale: number;
  ariaLabel: string;
  readout: string;
  disabled?: boolean;
  onCommit: (value: number) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const focusField = useCallback((field: HTMLInputElement | null) => {
    field?.focus();
    field?.select();
  }, []);

  if (text === null) {
    return (
      <button
        type="button"
        disabled={disabled}
        title={t("launcher.fields.typeNumber")}
        aria-label={t("launcher.fields.typeNumberAria", { label: ariaLabel })}
        className={cn(
          "w-12 shrink-0 text-right font-mono text-caption text-muted-foreground tabular-nums",
          disabled ? "opacity-50" : "hover:text-foreground",
        )}
        onClick={() => {
          setText(readoutDisplayText(value, displayScale));
        }}
      >
        {readout}
      </button>
    );
  }

  return (
    <input
      ref={focusField}
      value={text}
      inputMode="decimal"
      aria-label={ariaLabel}
      className="w-12 shrink-0 rounded-sm text-right font-mono text-caption text-foreground tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onChange={(e) => {
        setText(e.currentTarget.value);
      }}
      onBlur={() => {
        const cancelled = cancelledRef.current;
        cancelledRef.current = false;
        const typed = text;
        setText(null);
        if (cancelled) return;
        const parsed = parseTypedNumber(typed);
        if (parsed === null) return;
        onCommit(clampToRange(roundToStepPrecision(parsed / displayScale, step), min, max));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "Escape") {
          cancelledRef.current = e.key === "Escape";
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export function SettingSlider({
  value,
  min,
  max,
  step,
  ariaLabel,
  readout,
  disabled,
  displayScale = 1,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  ariaLabel: string;
  readout: string;
  disabled?: boolean;
  displayScale?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex w-full items-center gap-2.5">
      <Slider
        className="min-w-0 flex-1"
        min={min}
        max={max}
        step={step}
        value={[value]}
        disabled={disabled}
        aria-label={ariaLabel}
        onValueChange={([next]) => {
          if (next === undefined) return;
          onChange(next);
        }}
      />
      <SliderReadout
        value={value}
        min={min}
        max={max}
        step={step}
        displayScale={displayScale}
        ariaLabel={ariaLabel}
        readout={readout}
        disabled={disabled}
        onCommit={onChange}
      />
    </div>
  );
}
