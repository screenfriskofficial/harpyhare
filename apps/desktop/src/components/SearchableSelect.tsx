import { Check, ChevronDown } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface SearchableOption {
  value: string;
  label: string;
  description?: string;
  keywords?: string[];
  disabled?: boolean;
  group?: string;
  icon?: ReactNode;
}

export function SearchableSelect({
  value,
  options,
  ariaLabel,
  placeholder,
  emptyLabel,
  disabled,
  status,
  onValueChange,
}: {
  value: string;
  options: SearchableOption[];
  ariaLabel: string;
  placeholder: string;
  emptyLabel: string;
  disabled?: boolean;
  status?: ReactNode;
  onValueChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value);
  const groups = new Map<string, SearchableOption[]>();
  for (const option of options) {
    const group = option.group ?? "";
    const rows = groups.get(group) ?? [];
    rows.push(option);
    groups.set(group, rows);
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-controls={open ? listId : undefined}
          aria-label={ariaLabel}
          disabled={disabled}
          className="w-full min-w-0 justify-between font-normal"
          onKeyDown={(event) => {
            if (!open && ["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
              event.preventDefault();
              event.stopPropagation();
              setOpen(true);
            }
          }}
        >
          <span className="truncate" title={selected?.label ?? value}>
            {selected?.label ?? value}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        id={listId}
        align="end"
        className="flex max-h-(--radix-popover-content-available-height) w-[max(var(--radix-popover-trigger-width),16rem)] max-w-[calc(100vw-2rem)] flex-col overflow-hidden p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          searchRef.current?.focus();
        }}
      >
        <Command>
          <CommandInput ref={searchRef} placeholder={placeholder} aria-label={placeholder} />
          {status}
          <CommandList>
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            {Array.from(groups, ([group, groupOptions]) => (
              <CommandGroup key={group} heading={group || undefined}>
                {groupOptions.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    keywords={[option.label, group, ...(option.keywords ?? [])]}
                    disabled={option.disabled}
                    onSelect={() => {
                      onValueChange(option.value);
                      setOpen(false);
                    }}
                  >
                    {option.icon}
                    <span className="min-w-0 flex-1">
                      <span className="block leading-snug break-words whitespace-normal">
                        {option.label}
                      </span>
                      {option.description && (
                        <span className="block text-caption break-words text-muted-foreground">
                          {option.description}
                        </span>
                      )}
                    </span>
                    <Check
                      className={cn("ml-auto size-3.5", option.value !== value && "invisible")}
                      aria-hidden
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
