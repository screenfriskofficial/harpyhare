import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { searchLauncher, type SearchHit, type SearchSources } from "./search";

const MAX_RESULTS = 8;
const FIRST_INDEX = 0;
const NEXT_STEP = 1;
const PREVIOUS_STEP = -1;

const LIST_ID = "launcher-search-results";

function optionDomId(hitId: string): string {
  return `launcher-search-option-${hitId}`;
}

interface LauncherSearchProps {
  sources: SearchSources;
  onNavigate: (hit: SearchHit) => void;
}

export function LauncherSearch({ sources, onNavigate }: LauncherSearchProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(FIRST_INDEX);
  const placeholder = t("launcher.search.placeholder");

  // `t` в зависимостях: индекс собирается из словаря и пересобирается со сменой языка.
  // Translation helpers read the active language; changing it invalidates this memo.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const hits = useMemo(() => searchLauncher(query, sources), [query, sources, t]);
  const shown = hits.slice(FIRST_INDEX, MAX_RESULTS);
  const activeIndex = Math.min(active, shown.length - 1);
  const listVisible = open && query.trim() !== "";

  const reset = () => {
    setQuery("");
    setOpen(false);
    setActive(FIRST_INDEX);
  };

  const choose = (hit: SearchHit) => {
    onNavigate(hit);
    reset();
  };

  const step = (delta: number) => {
    if (shown.length === 0) return;
    setActive((current) => {
      const next = Math.min(current, shown.length - 1) + delta;
      return (next + shown.length) % shown.length;
    });
  };

  return (
    <div className="relative min-w-0 flex-1">
      <Search
        className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        value={query}
        placeholder={placeholder}
        aria-label={placeholder}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={listVisible}
        aria-controls={listVisible ? LIST_ID : undefined}
        aria-activedescendant={
          listVisible && shown[activeIndex] ? optionDomId(shown[activeIndex].id) : undefined
        }
        autoComplete="off"
        spellCheck={false}
        className="h-7 pl-7 text-body focus-visible:ring-inset"
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(FIRST_INDEX);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
        }}
        onBlur={() => {
          setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            reset();
            return;
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            step(NEXT_STEP);
            return;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            step(PREVIOUS_STEP);
            return;
          }
          if (e.key !== "Enter") return;
          const hit = shown[activeIndex];
          if (!hit) return;
          e.preventDefault();
          choose(hit);
        }}
      />

      {listVisible && (
        <div
          role="listbox"
          id={LIST_ID}
          aria-label={placeholder}
          data-no-drag
          className="absolute top-full right-0 left-0 z-20 mt-1.5 max-h-80 animate-in overflow-y-auto rounded-lg border bg-popover p-1 shadow-pop duration-150 fade-in-0 slide-in-from-top-1 motion-reduce:animate-none"
          onMouseDown={(e) => {
            e.preventDefault();
          }}
        >
          {shown.length === 0 && (
            <p className="px-2 py-1.5 text-caption text-muted-foreground">
              {t("common.nothingFound")}
            </p>
          )}
          {shown.map((hit, index) => (
            <button
              key={hit.id}
              id={optionDomId(hit.id)}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={cn(
                "flex w-full items-center gap-3 rounded-sm px-2 py-1 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                index === activeIndex
                  ? "bg-surface-active"
                  : "hover:bg-surface active:bg-surface-active",
              )}
              onMouseEnter={() => {
                setActive(index);
              }}
              onClick={() => {
                choose(hit);
              }}
            >
              <span className="min-w-0 flex-1 truncate text-body text-foreground">{hit.title}</span>
              <span className="max-w-[45%] shrink-0 truncate text-hint text-muted-foreground">
                {hit.breadcrumb}
              </span>
            </button>
          ))}
          {hits.length > shown.length && (
            <p className="mt-1 border-t border-border px-2 py-1.5 text-hint text-muted-foreground">
              {t("launcher.search.overflow", { shown: shown.length, total: hits.length })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
