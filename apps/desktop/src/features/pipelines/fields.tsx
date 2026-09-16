import type { ReactNode } from "react";
import { SettingSelect, SettingSwitch } from "@/features/launcher/fields";

const FIELD_CLASS = "flex min-w-0 flex-col gap-1.5 text-caption text-muted-foreground";

/** Caption above a text control; the `<label>` makes a click on the caption focus it. */
export function PipelineField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={FIELD_CLASS}>
      <span>{label}</span>
      {children}
    </label>
  );
}

/** Caption above a select. The select is a button that carries the caption as its own label. */
export function PipelineSelectField({
  label,
  value,
  placeholder,
  disabled,
  onValueChange,
  children,
}: {
  label: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onValueChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <div className={FIELD_CLASS}>
      <span>{label}</span>
      <SettingSelect
        value={value}
        ariaLabel={label}
        placeholder={placeholder}
        disabled={disabled}
        onValueChange={onValueChange}
      >
        {children}
      </SettingSelect>
    </div>
  );
}

export function PipelineSwitch({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-body">
      <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
      <SettingSwitch
        ariaLabel={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </div>
  );
}
