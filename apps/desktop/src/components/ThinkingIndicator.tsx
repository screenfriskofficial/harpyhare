import { useEffect, useState } from "react";
import { StatusOrb } from "@/components/StatusOrb";

const SECOND_MS = 1000;
const SECONDS_PER_MINUTE = 60;

const elapsedSeconds = (startedAt: number) =>
  Math.max(0, Math.floor((Date.now() - startedAt) / SECOND_MS));

const formatElapsed = (seconds: number) => {
  if (seconds < SECONDS_PER_MINUTE) return `${seconds}с`;
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  return `${minutes}м ${seconds % SECONDS_PER_MINUTE}с`;
};

function useElapsedSeconds(startedAt: number) {
  const [seconds, setSeconds] = useState(() => elapsedSeconds(startedAt));

  useEffect(() => {
    setSeconds(elapsedSeconds(startedAt));
    const id = setInterval(() => {
      setSeconds(elapsedSeconds(startedAt));
    }, SECOND_MS);
    return () => {
      clearInterval(id);
    };
  }, [startedAt]);

  return seconds;
}

export function ThinkingIndicator({ startedAt }: { startedAt: number | undefined }) {
  // Фолбэк защёлкивается один раз: `Date.now()` в пропсе давал бы новый старт
  // на каждый рендер, интервал пересоздавался бы, и счётчик вечно показывал 0с.
  const [mountedAt] = useState(() => Date.now());
  const seconds = useElapsedSeconds(startedAt ?? mountedAt);

  return (
    <div className="flex animate-in items-baseline gap-2 duration-200 fade-in motion-reduce:animate-none">
      <StatusOrb state="solving" />
      <span className="thinking-shimmer text-body font-medium" aria-live="polite">
        Думает…
      </span>
      <span className="font-mono text-caption text-muted-foreground/60 tabular-nums" aria-hidden>
        {formatElapsed(seconds)}
      </span>
    </div>
  );
}
