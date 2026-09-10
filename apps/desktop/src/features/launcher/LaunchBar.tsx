import { ChevronRight, Play } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { StatusOrb } from "@/components/StatusOrb";
import { Button } from "@/components/ui/button";
import { ORB_STATE_IDLE } from "@/components/ui/thinking-orbs";
import { useWindowDrag } from "@/hooks/useWindowDrag";
import { t } from "@/i18n";
import { BRAND_NAME } from "@/lib/brand";
import { PLATFORM } from "@/lib/platform";
import { cn } from "@/lib/utils";
import type { LauncherBlocker, LauncherReadiness } from "./useLauncherReadiness";

const MACOS_TRAFFIC_LIGHTS_CLASS = PLATFORM === "macos" ? "pl-16" : "";

function statusText(readiness: LauncherReadiness, launching: boolean, saving: boolean): string {
  if (launching) return t("launcher.status.launching");
  if (readiness.checking) return t("launcher.status.checking");
  if (saving) return t("launcher.status.saving");
  const blocker = readiness.blockers[0];
  if (blocker) return blocker.label;
  return t("launcher.status.ready");
}

function StatusLine({
  readiness,
  launching,
  saving,
  checkingSession,
  onGoToBlocker,
}: {
  readiness: LauncherReadiness;
  launching: boolean;
  saving: boolean;
  checkingSession: boolean;
  onGoToBlocker: (blocker: LauncherBlocker) => void;
}) {
  const blocker = readiness.blockers[0];
  const busy = launching || readiness.checking || saving || checkingSession;
  const text = checkingSession
    ? t("launcher.status.checking")
    : statusText(readiness, launching, saving);
  const dot = (
    <span
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        busy && "bg-muted-foreground/40",
        !busy && (blocker ? "bg-destructive" : "bg-primary"),
      )}
      aria-hidden
    />
  );

  if (blocker && !busy) {
    return (
      <Button
        variant="ghost"
        size="compact"
        className="max-w-full min-w-0 gap-2 overflow-hidden text-muted-foreground"
        onClick={() => {
          onGoToBlocker(blocker);
        }}
      >
        {dot}
        <span className="min-w-0 truncate" title={text}>
          {text}
        </span>
        <ChevronRight className="size-3 shrink-0 text-muted-foreground/70" aria-hidden />
      </Button>
    );
  }

  return (
    <span className="inline-flex h-6.5 max-w-full min-w-0 items-center gap-2 overflow-hidden px-2 text-caption text-muted-foreground">
      {dot}
      <span className="min-w-0 truncate" title={text}>
        {text}
      </span>
    </span>
  );
}

export function LaunchBar({
  readiness,
  launching,
  saving,
  search,
  onGoToBlocker,
  onLaunch,
  checkingSession = false,
}: {
  readiness: LauncherReadiness;
  launching: boolean;
  saving: boolean;
  search: ReactNode;
  onGoToBlocker: (blocker: LauncherBlocker) => void;
  onLaunch: () => void;
  checkingSession?: boolean;
}) {
  const { t } = useTranslation();
  const onDragMouseDown = useWindowDrag();
  return (
    <header
      onMouseDown={onDragMouseDown}
      className={cn("flex h-9 shrink-0 items-center gap-3", MACOS_TRAFFIC_LIGHTS_CLASS)}
    >
      <div className="flex shrink-0 items-center gap-2">
        <StatusOrb state={launching ? "connecting" : ORB_STATE_IDLE} />
        <h1 className="font-mono text-hint font-semibold tracking-wider text-foreground/55 uppercase">
          {BRAND_NAME}
        </h1>
      </div>

      <div className="max-w-96 min-w-0 flex-1">{search}</div>

      <div className="ml-auto flex min-w-0 items-center gap-1.5">
        <div className="max-w-80 min-w-0 overflow-hidden">
          <StatusLine
            readiness={readiness}
            launching={launching}
            saving={saving}
            checkingSession={checkingSession}
            onGoToBlocker={onGoToBlocker}
          />
        </div>
        <Button
          size="compact"
          className="shrink-0 gap-1.5"
          disabled={
            launching || checkingSession || saving || readiness.checking || !readiness.ready
          }
          onClick={onLaunch}
        >
          <Play className="size-3" aria-hidden />
          {launching ? t("launcher.launching") : t("launcher.launch")}
        </Button>
      </div>
    </header>
  );
}
