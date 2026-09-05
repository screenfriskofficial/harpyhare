import { useCallback, useState } from "react";
import { cn } from "@/lib/cn";
import { HudChat } from "./HudChat";
import { HudComposer } from "./HudComposer";
import { HudHeader, type HudMode } from "./HudHeader";
import { toReadingText } from "./HudMarkdown";
import { HudNotes } from "./HudNotes";
import { ModelMenuOverlay, TeleprompterOverlay } from "./HudOverlays";
import type { DemoRun } from "./useDemoRun";

const DEFAULT_VOICE = "groq";

/**
 * Окно HUD: скруглённое на 22px, полупрозрачное, с хайрлайном по краю и
 * «жидкометаллической» рамкой, пока идёт запись или ответ — как в приложении.
 */
export function HudWindow({
  run,
  onCollapse,
  onStop,
}: {
  run: DemoRun;
  onCollapse: () => void;
  onStop: () => void;
}) {
  const [mode, setMode] = useState<HudMode>("chat");
  const [screenShareVisible, setScreenShareVisible] = useState(false);
  const [teleprompterOpen, setTeleprompterOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [voice, setVoice] = useState(DEFAULT_VOICE);

  const active = run.active;
  const activeStream = run.stream?.chatId === run.activeId ? run.stream : null;
  const streaming = activeStream !== null;
  const partial = activeStream === null ? null : activeStream.partial;
  const activity = run.recorder !== "idle" || run.stream !== null;
  const lastAnswer = [...active.messages].reverse().find((m) => m.role === "assistant")?.text ?? "";
  const teleprompterText = toReadingText(partial !== null && partial !== "" ? partial : lastAnswer);

  const closeTeleprompter = useCallback(() => {
    setTeleprompterOpen(false);
  }, []);
  const closeModels = useCallback(() => {
    setModelsOpen(false);
  }, []);
  const leaveNotes = useCallback(() => {
    setMode("chat");
  }, []);
  const toggleDoc = useCallback(
    (id: string) => {
      const ids = active.libraryDocIds;
      run.patchParams({
        libraryDocIds: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
      });
    },
    [active.libraryDocIds, run],
  );

  return (
    <div
      className={cn(
        "app-hud relative flex h-full w-full flex-col gap-2.5 overflow-hidden rounded-[22px] p-3 text-app-fg",
      )}
    >
      {activity && <span className="app-liquid-frame" aria-hidden />}
      <HudHeader
        run={run}
        mode={mode}
        screenShareVisible={screenShareVisible}
        onSelectMode={setMode}
        onToggleScreenShare={() => {
          setScreenShareVisible((v) => !v);
        }}
        onOpenTeleprompter={() => {
          setTeleprompterOpen(true);
        }}
        onOpenModels={() => {
          setModelsOpen(true);
        }}
        onCollapse={onCollapse}
        onStop={onStop}
      />

      {mode === "notes" ? (
        <HudNotes
          selectedDocIds={active.libraryDocIds}
          onToggleDoc={toggleDoc}
          onLeave={leaveNotes}
        />
      ) : (
        <>
          <HudChat
            chatId={active.id}
            messages={active.messages}
            partial={partial}
            streaming={streaming}
            streamStartedAt={activeStream?.startedAt ?? 0}
            onRemoveMessage={run.removeMessage}
            onResendMessage={run.resendFrom}
          />
          <HudComposer
            chat={active}
            streaming={streaming}
            onDraftChange={run.setDraft}
            onPatch={run.patchParams}
            onSend={run.send}
            onStop={run.stopStream}
            onClearHistory={run.clearHistory}
            onQuickAction={run.runQuickAction}
            onScreenshot={() => undefined}
          />
        </>
      )}

      {modelsOpen && (
        <ModelMenuOverlay
          model={active.model}
          voice={voice}
          onSelectModel={(model) => {
            run.patchParams({ model });
          }}
          onSelectVoice={setVoice}
          onClose={closeModels}
        />
      )}
      {teleprompterOpen && (
        <TeleprompterOverlay text={teleprompterText} onClose={closeTeleprompter} />
      )}
    </div>
  );
}
