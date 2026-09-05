import { Minus, Pause, Play, Plus, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { IconButton } from "@/components/IconButton";
import { ShortcutTooltip } from "@/components/ShortcutTooltip";
import { useLatestRef } from "@/hooks/useLatestRef";
import { matchesPrepared, prepareCombo } from "@/lib/hotkey-match";
import { formatCombo } from "@/lib/hotkeys";
import {
  advanceOffset,
  clampFont,
  clampSpeed,
  TELEPROMPTER_FONT_STEP,
  TELEPROMPTER_SPEED_STEP,
} from "@/lib/teleprompter";

export interface TeleprompterProps {
  text: string;
  initialSpeed: number;
  initialFontSize: number;
  initialOffset: number;
  onPersist: (speed: number, fontSize: number, offset: number) => void;
  onClose: () => void;
  closeCombo: string;
  pauseCombo: string;
}

const EDGE_FADE =
  "linear-gradient(to bottom, transparent 0%, black 26%, black 74%, transparent 100%)";
const EMPTY_HINT = "Нет ответа для суфлёра";
const PAUSE_LABEL = "Пауза";
const PLAY_LABEL = "Воспроизвести";
const CLOSE_LABEL = "Закрыть";

/**
 * Прокрутка крутится только пока `playing`: цикл на паузе будил бы главный
 * поток 60 раз в секунду всё интервью. Дойдя до низа, движение НЕ ставит
 * паузу само — текст суфлёра стримовый и растёт, и автопауза на коротком
 * хвосте останавливала бы суфлёр после каждой догнанной строки.
 */
function useAutoScroll(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  offsetRef: React.RefObject<number>,
  speedRef: React.RefObject<number>,
  playing: boolean,
): void {
  useEffect(() => {
    if (!playing) return;
    let lastTs = 0;
    let raf = 0;
    const tick = (ts: number) => {
      const el = scrollRef.current;
      if (el) {
        const elapsed = lastTs === 0 ? 0 : ts - lastTs;
        lastTs = ts;
        const maxOffset = el.scrollHeight - el.clientHeight;
        offsetRef.current = advanceOffset(offsetRef.current, speedRef.current, elapsed, maxOffset);
        el.scrollTop = offsetRef.current;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [playing, scrollRef, offsetRef, speedRef]);
}

export function Teleprompter({
  text,
  initialSpeed,
  initialFontSize,
  initialOffset,
  closeCombo,
  pauseCombo,
  onPersist,
  onClose,
}: TeleprompterProps) {
  const [speed, setSpeed] = useState(() => clampSpeed(initialSpeed));
  const [fontSize, setFontSize] = useState(() => clampFont(initialFontSize));
  const [playing, setPlaying] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(initialOffset);
  const speedRef = useLatestRef(speed);
  const valuesRef = useLatestRef({ speed, fontSize });
  const onPersistRef = useLatestRef(onPersist);
  const onCloseRef = useLatestRef(onClose);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = offsetRef.current;
  }, []);

  useAutoScroll(scrollRef, offsetRef, speedRef, playing);

  // На размонтировании отдаём наружу последние скорость, шрифт и позицию.
  useEffect(() => {
    const persist = onPersistRef;
    const values = valuesRef;
    const offset = offsetRef;
    return () => {
      persist.current(values.current.speed, values.current.fontSize, offset.current);
    };
  }, [onPersistRef, valuesRef]);

  const syncOffsetFromScroll = useCallback(() => {
    if (scrollRef.current) offsetRef.current = scrollRef.current.scrollTop;
  }, []);

  const restart = useCallback(() => {
    offsetRef.current = 0;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setPlaying(true);
  }, []);

  // Колбэк закрытия читается из ref: пока суфлёр показывает стрим, App
  // рендерится каждый кадр, и подписка с `onClose` в зависимостях
  // пересоздавалась бы вместе с `prepareCombo` на каждый рендер.
  useEffect(() => {
    const close = prepareCombo(closeCombo);
    const pause = prepareCombo(pauseCombo);
    const onKey = (e: KeyboardEvent) => {
      if (matchesPrepared(e, close)) {
        e.preventDefault();
        onCloseRef.current();
      } else if (matchesPrepared(e, pause)) {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onCloseRef, closeCombo, pauseCombo]);

  return (
    // Без `backdrop-blur`: под оверлеем каждый кадр стрима перерисовывается
    // лента, и полноэкранный блюр пересчитывался бы поверх WebGL-рамки.
    <div className="absolute inset-0 z-50 flex flex-col bg-black/90">
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={syncOffsetFromScroll}
          className="no-scrollbar h-full overflow-y-auto overscroll-contain"
          style={{ maskImage: EDGE_FADE, WebkitMaskImage: EDGE_FADE }}
        >
          <div
            className="mx-auto max-w-[26ch] px-8 text-center leading-[1.7] font-medium tracking-wide whitespace-pre-wrap text-foreground/90"
            style={{ fontSize, paddingTop: "46vh", paddingBottom: "54vh" }}
          >
            {text || EMPTY_HINT}
          </div>
        </div>
        <div
          className="pointer-events-none absolute inset-x-0 top-1/2 h-16 -translate-y-1/2 bg-primary/5"
          aria-hidden
        />
      </div>

      <div className="flex items-center justify-center gap-1.5 pb-3">
        <IconButton title="Сначала" onClick={restart}>
          <RotateCcw />
        </IconButton>
        <ShortcutTooltip
          label={playing ? PAUSE_LABEL : PLAY_LABEL}
          shortcut={formatCombo(pauseCombo)}
        >
          <IconButton
            title=""
            aria-label={playing ? PAUSE_LABEL : PLAY_LABEL}
            onClick={() => {
              setPlaying((p) => !p);
            }}
          >
            {playing ? <Pause /> : <Play />}
          </IconButton>
        </ShortcutTooltip>

        <Stepper
          label="Скорость"
          value={String(Math.round(speed))}
          onDec={() => {
            setSpeed((s) => clampSpeed(s - TELEPROMPTER_SPEED_STEP));
          }}
          onInc={() => {
            setSpeed((s) => clampSpeed(s + TELEPROMPTER_SPEED_STEP));
          }}
        />
        <Stepper
          label="Шрифт"
          value={String(Math.round(fontSize))}
          onDec={() => {
            setFontSize((f) => clampFont(f - TELEPROMPTER_FONT_STEP));
          }}
          onInc={() => {
            setFontSize((f) => clampFont(f + TELEPROMPTER_FONT_STEP));
          }}
        />

        <ShortcutTooltip label={CLOSE_LABEL} shortcut={formatCombo(closeCombo)}>
          <IconButton title="" aria-label={CLOSE_LABEL} onClick={onClose}>
            <X />
          </IconButton>
        </ShortcutTooltip>
      </div>
    </div>
  );
}

function Stepper({
  label,
  value,
  onDec,
  onInc,
}: {
  label: string;
  value: string;
  onDec: () => void;
  onInc: () => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-surface px-0.5 ring-1 ring-border ring-inset">
      <IconButton title={`${label} −`} onClick={onDec}>
        <Minus />
      </IconButton>
      <span className="w-14 text-center font-mono text-caption text-muted-foreground tabular-nums">
        {label} {value}
      </span>
      <IconButton title={`${label} +`} onClick={onInc}>
        <Plus />
      </IconButton>
    </div>
  );
}
