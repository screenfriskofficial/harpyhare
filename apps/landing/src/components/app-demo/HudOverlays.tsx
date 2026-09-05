import {
  Check,
  Lock,
  Maximize2,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { OrbState } from "thinking-orbs";
import { cn } from "@/lib/cn";
import { useCopy } from "./copy";
import { AppIconButton, AppOrb, ComboChip, ORB_STATE_IDLE } from "./ui";
import type { DemoRun } from "./useDemoRun";

const EDGE_FADE =
  "linear-gradient(to bottom, transparent 0%, black 26%, black 74%, transparent 100%)";
const SPEED_MIN = 10;
const SPEED_MAX = 150;
const SPEED_STEP = 5;
const FONT_MIN = 20;
const FONT_MAX = 48;
const FONT_STEP = 2;
const DEFAULT_SPEED = 40;
const DEFAULT_FONT = 28;
const MILLIS_PER_SECOND = 1000;
const PAUSE_COMBO = "␣";
const CLOSE_COMBO = "Esc";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function Stepper({
  label,
  value,
  onDec,
  onInc,
}: {
  label: string;
  value: number;
  onDec: () => void;
  onInc: () => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-app-surface px-0.5 ring-1 ring-app-border ring-inset">
      <AppIconButton title={`${label} −`} onClick={onDec}>
        <Minus />
      </AppIconButton>
      <span className="w-14 text-center font-mono text-app-caption text-app-muted tabular-nums">
        {label} {value}
      </span>
      <AppIconButton title={`${label} +`} onClick={onInc}>
        <Plus />
      </AppIconButton>
    </div>
  );
}

/**
 * Суфлёр: крупный текст с плавной автопрокруткой. Дойдя до низа, паузу не
 * ставит — как в приложении, где текст стримовый и растёт.
 */
export function TeleprompterOverlay({ text, onClose }: { text: string; onClose: () => void }) {
  const copy = useCopy().hud.teleprompter;
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const [fontSize, setFontSize] = useState(DEFAULT_FONT);
  const [playing, setPlaying] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  useEffect(() => {
    if (!playing) return;
    let lastTs = 0;
    let raf = 0;
    const tick = (ts: number) => {
      const el = scrollRef.current;
      if (el) {
        const elapsed = lastTs === 0 ? 0 : ts - lastTs;
        lastTs = ts;
        const maxOffset = Math.max(0, el.scrollHeight - el.clientHeight);
        offsetRef.current = clamp(
          offsetRef.current + (speedRef.current * elapsed) / MILLIS_PER_SECOND,
          0,
          maxOffset,
        );
        el.scrollTop = offsetRef.current;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [playing]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="absolute inset-0 z-50 flex flex-col rounded-[inherit] bg-black/90">
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={() => {
            if (scrollRef.current) offsetRef.current = scrollRef.current.scrollTop;
          }}
          className="app-no-scrollbar h-full overflow-y-auto overscroll-contain"
          style={{ maskImage: EDGE_FADE, WebkitMaskImage: EDGE_FADE }}
        >
          {/* Отступы — доли высоты окна, а не вьюпорта: в приложении окно и есть вьюпорт. */}
          <div style={{ height: "46%" }} aria-hidden />
          <div
            className="mx-auto max-w-[26ch] px-8 text-center leading-[1.7] font-medium tracking-wide whitespace-pre-wrap text-app-fg/90"
            style={{ fontSize }}
          >
            {text || copy.empty}
          </div>
          <div style={{ height: "54%" }} aria-hidden />
        </div>
        <div
          className="pointer-events-none absolute inset-x-0 top-1/2 h-16 -translate-y-1/2 bg-app-primary/5"
          aria-hidden
        />
      </div>
      <div className="flex items-center justify-center gap-1.5 pb-3">
        <AppIconButton
          title={copy.restart}
          onClick={() => {
            offsetRef.current = 0;
            if (scrollRef.current) scrollRef.current.scrollTop = 0;
            setPlaying(true);
          }}
        >
          <RotateCcw />
        </AppIconButton>
        <AppIconButton
          title={`${playing ? copy.pause : copy.play} ${PAUSE_COMBO}`}
          aria-label={playing ? copy.pause : copy.play}
          onClick={() => {
            setPlaying((p) => !p);
          }}
        >
          {playing ? <Pause /> : <Play />}
        </AppIconButton>
        <Stepper
          label={copy.speed}
          value={speed}
          onDec={() => {
            setSpeed((s) => clamp(s - SPEED_STEP, SPEED_MIN, SPEED_MAX));
          }}
          onInc={() => {
            setSpeed((s) => clamp(s + SPEED_STEP, SPEED_MIN, SPEED_MAX));
          }}
        />
        <Stepper
          label={copy.font}
          value={fontSize}
          onDec={() => {
            setFontSize((f) => clamp(f - FONT_STEP, FONT_MIN, FONT_MAX));
          }}
          onInc={() => {
            setFontSize((f) => clamp(f + FONT_STEP, FONT_MIN, FONT_MAX));
          }}
        />
        <AppIconButton
          title={`${copy.close} ${CLOSE_COMBO}`}
          aria-label={copy.close}
          onClick={onClose}
        >
          <X />
        </AppIconButton>
      </div>
    </div>
  );
}

function MenuItem({
  label,
  active,
  locked,
  lockedHint,
  onSelect,
}: {
  label: string;
  active: boolean;
  locked: boolean;
  lockedHint: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      disabled={locked}
      onClick={onSelect}
      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-app-body text-app-fg transition-colors outline-none hover:bg-app-surface-active disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0"
    >
      {locked && <Lock aria-hidden />}
      <span className="min-w-0 truncate">{label}</span>
      {locked && <span className="ml-auto text-app-hint text-app-muted">{lockedHint}</span>}
      <Check className={cn(!locked && "ml-auto", !active && "invisible")} />
    </button>
  );
}

/** Меню моделей (⌘⇧M): голосовая модель и модели ответа по вендорам, с поиском. */
export function ModelMenuOverlay({
  model,
  voice,
  onSelectModel,
  onSelectVoice,
  onClose,
}: {
  model: string;
  voice: string;
  onSelectModel: (id: string) => void;
  onSelectVoice: (id: string) => void;
  onClose: () => void;
}) {
  const copy = useCopy().hud;
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const needle = query.trim().toLowerCase();
  const matches = (label: string) => needle === "" || label.toLowerCase().includes(needle);
  const voiceRows = copy.models.voice.filter((v) => matches(v.label));
  const groups = copy.models.groups
    .map((group) => ({ ...group, models: group.models.filter((m) => matches(m.label)) }))
    .filter((group) => group.models.length > 0);
  const nothing = voiceRows.length === 0 && groups.length === 0;

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center rounded-[inherit] bg-black/55 p-4"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label={copy.models.title}
        className="flex w-[min(360px,100%)] flex-col overflow-hidden rounded-xl border border-app-border bg-app-popover text-app-fg shadow-app-modal"
      >
        <div className="flex items-center gap-2 border-b border-app-border px-3">
          <Search className="size-3.5 shrink-0 text-app-muted" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            placeholder={copy.models.searchPlaceholder}
            aria-label={copy.models.searchPlaceholder}
            className="flex h-9 w-full bg-transparent text-app-body text-app-fg outline-none placeholder:text-app-muted/60"
          />
        </div>
        <div className="app-scroll max-h-[300px] overflow-y-auto p-1" role="listbox">
          {nothing && (
            <div className="py-6 text-center text-app-body text-app-muted">{copy.models.empty}</div>
          )}
          {voiceRows.length > 0 && (
            <div className="px-2 py-1.5 text-app-hint font-medium text-app-muted">
              {copy.models.voiceHeading}
            </div>
          )}
          {voiceRows.map((row) => (
            <MenuItem
              key={row.id}
              label={row.label}
              active={row.id === voice}
              locked={row.locked}
              lockedHint={copy.composer.missingKey}
              onSelect={() => {
                onSelectVoice(row.id);
                onClose();
              }}
            />
          ))}
          {groups.map((group) => (
            <div key={group.id}>
              <div className="px-2 py-1.5 text-app-hint font-medium text-app-muted">
                {copy.models.groups.length > 1
                  ? `${copy.models.answerHeading} · ${group.label}`
                  : copy.models.answerHeading}
              </div>
              {group.models.map((m) => (
                <MenuItem
                  key={m.id}
                  label={m.label}
                  active={m.id === model}
                  locked={group.locked}
                  lockedHint={copy.composer.missingKey}
                  onSelect={() => {
                    onSelectModel(m.id);
                    onClose();
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type MiniStatus = "recording" | "transcribing" | "streaming" | "unread" | "idle";

function miniStatus(run: DemoRun): MiniStatus {
  if (run.recorder === "recording") return "recording";
  if (run.recorder === "transcribing") return "transcribing";
  if (run.stream !== null) return "streaming";
  if (run.chats.some((chat) => run.unread[chat.id])) return "unread";
  return "idle";
}

const MINI_ORB: Record<MiniStatus, OrbState> = {
  recording: "listening",
  transcribing: "working",
  streaming: "composing",
  unread: ORB_STATE_IDLE,
  idle: ORB_STATE_IDLE,
};

/** Мини-режим: окно сжато в пилюлю со статусом, из любого приложения видно, что происходит. */
export function MiniHud({
  run,
  active,
  onExpand,
}: {
  run: DemoRun;
  active: boolean;
  onExpand: () => void;
}) {
  const copy = useCopy().hud.mini;
  const status = miniStatus(run);
  const label =
    status === "idle"
      ? ""
      : status === "unread"
        ? copy.unread
        : status === "streaming"
          ? copy.streaming
          : status === "transcribing"
            ? copy.transcribing
            : copy.recording;
  const bright = status === "recording" || status === "unread";
  return (
    <div className="relative flex h-9 w-60 items-center gap-2 rounded-full bg-app-bg py-1 pr-1 pl-3 ring-1 ring-app-border ring-inset">
      {active && <span className="app-liquid-frame rounded-full" aria-hidden />}
      <AppOrb state={MINI_ORB[status]} />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-app-caption",
          bright ? "text-app-fg" : "text-app-muted",
        )}
      >
        {label}
      </span>
      <span className="relative inline-flex">
        <AppIconButton title={`${copy.expand} ⌘⇧H`} aria-label={copy.expand} onClick={onExpand}>
          <Maximize2 />
        </AppIconButton>
        <ComboChip combo="⌘⇧H" className="sr-only" />
      </span>
    </div>
  );
}
