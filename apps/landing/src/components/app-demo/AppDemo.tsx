"use client";

import { Mic } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { VoicePrompt } from "@/i18n/demo-types";
import type { Dictionary } from "@/i18n/types";
import { DemoCopyProvider } from "./copy";
import { MiniHud } from "./HudOverlays";
import { HudWindow } from "./HudWindow";
import { LauncherWindow } from "./LauncherWindow";
import type { AppTheme } from "./types";
import { useDemoRun } from "./useDemoRun";

const LAUNCH_MS = 800;

/**
 * Чужой экран под окном: HUD полупрозрачный и плавает поверх созвона, и без
 * подложки прозрачность просто не видна. Абстрактный созвон — плитки
 * участников и панель управления, ничего не читается.
 */
function DesktopBackdrop() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-[oklch(0.2_0.004_285)]" aria-hidden>
      <div className="absolute inset-x-6 top-6 bottom-16 grid grid-cols-2 gap-3 opacity-70 sm:inset-x-10 sm:top-8">
        {[0, 1, 2, 3].map((tile) => (
          <div
            key={tile}
            className="relative rounded-xl bg-[oklch(0.27_0.005_285)] ring-1 ring-white/5"
          >
            <span className="absolute top-1/2 left-1/2 size-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/8 sm:size-14" />
            <span className="absolute bottom-3 left-3 h-2 w-16 rounded-full bg-white/10" />
          </div>
        ))}
      </div>
      <div className="absolute inset-x-0 bottom-0 flex h-12 items-center justify-center gap-3 bg-[oklch(0.16_0.004_285)]">
        {[0, 1, 2, 3, 4].map((dot) => (
          <span
            key={dot}
            className={
              dot === 3
                ? "size-7 rounded-full bg-app-destructive/70"
                : "size-7 rounded-full bg-white/8"
            }
          />
        ))}
      </div>
    </div>
  );
}

export function AppDemo({ dict }: { dict: Dictionary }) {
  const copy = dict.app;
  const run = useDemoRun(copy);
  const [inHud, setInHud] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [mini, setMini] = useState(false);
  const [theme, setTheme] = useState<AppTheme>("black");
  const timerRef = useRef(0);

  useEffect(
    () => () => {
      clearTimeout(timerRef.current);
    },
    [],
  );

  const launch = () => {
    setLaunching(true);
    timerRef.current = window.setTimeout(() => {
      setLaunching(false);
      setInHud(true);
    }, LAUNCH_MS);
  };

  const backToLauncher = () => {
    clearTimeout(timerRef.current);
    setMini(false);
    setInHud(false);
  };

  const ask = (prompt: VoicePrompt) => {
    clearTimeout(timerRef.current);
    setLaunching(false);
    setMini(false);
    setInHud(true);
    run.askByVoice(prompt);
  };

  const activity = run.recorder !== "idle" || run.stream !== null;

  return (
    <DemoCopyProvider copy={copy}>
      <div className="fade-rise relative mx-auto mt-10 w-full sm:mt-12">
        <div
          className="shadow-poster sm:shadow-poster-lg relative overflow-hidden border-2 border-fg bg-app-bg"
          role="group"
          aria-label={copy.frameLabel}
          data-app-theme={theme}
        >
          <div className="relative h-[560px] sm:h-[600px]">
            {inHud ? (
              <>
                <DesktopBackdrop />
                <div className="absolute inset-0 grid place-items-center p-3">
                  {mini ? (
                    <MiniHud
                      run={run}
                      active={activity}
                      onExpand={() => {
                        setMini(false);
                      }}
                    />
                  ) : (
                    <div className="absolute inset-3 m-auto h-full max-h-[520px] w-full max-w-[400px]">
                      <HudWindow
                        run={run}
                        onCollapse={() => {
                          setMini(true);
                        }}
                        onStop={backToLauncher}
                      />
                    </div>
                  )}
                </div>
              </>
            ) : (
              <LauncherWindow
                launching={launching}
                theme={theme}
                onLaunch={launch}
                onThemeChange={setTheme}
              />
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <span className="inline-flex items-center gap-1.5 font-display text-[9.5px] font-medium tracking-[0.1em] text-fg-subtle uppercase">
            <Mic className="size-3.5" aria-hidden />
            {copy.ask}
          </span>
          {copy.prompts.map((prompt) => (
            <button
              key={prompt.chip}
              type="button"
              onClick={() => {
                ask(prompt);
              }}
              className="border border-border-strong px-3.5 py-2 text-[12.5px] text-fg-muted transition-colors hover:bg-surface hover:text-fg"
            >
              {prompt.chip}
            </button>
          ))}
        </div>

        <p className="mt-4 text-center text-[12px] text-balance text-fg-subtle">
          {copy.caption}
          {copy.disclosure !== null && <> {copy.disclosure}</>}
        </p>
      </div>
    </DemoCopyProvider>
  );
}
