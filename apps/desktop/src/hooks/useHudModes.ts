import { useCallback, useEffect, useState, type RefObject } from "react";
import { onEvent } from "@/ipc/events";
import { DEFAULT_MODE, nextMode, NOTES_MODE, type AppModeId } from "@/lib/modes";
import { keyboardLayerOpen } from "@/lib/portalled-layers";
import { useLatestRef } from "./useLatestRef";

export interface HudModes {
  miniMode: boolean;
  mode: AppModeId;
  notesMode: boolean;
  /** Latest values for handlers that subscribe once (event listeners, stream callbacks). */
  miniModeRef: RefObject<boolean>;
  notesModeRef: RefObject<boolean>;
  setMode: (mode: AppModeId) => void;
  /** Back to the chat, expanded: every path that puts text into the prompt calls this. */
  revealChat: () => void;
  /** The mode hotkey; an open cmdk/Radix keyboard layer keeps the key for itself. */
  toggleMode: () => void;
  collapse: () => void;
  expand: () => void;
}

/**
 * The HUD's two presentation switches: mini mode (the pill) and the chat/notes
 * mode. Neither persists — the app always starts in the chat, expanded. The
 * global hide/show hotkey arrives from Rust as the `toggle-mini` event.
 */
export function useHudModes(): HudModes {
  const [miniMode, setMiniMode] = useState(false);
  const [mode, setMode] = useState<AppModeId>(DEFAULT_MODE);
  const notesMode = mode === NOTES_MODE;
  const miniModeRef = useLatestRef(miniMode);
  const notesModeRef = useLatestRef(notesMode);

  const revealChat = useCallback(() => {
    setMiniMode(false);
    setMode(DEFAULT_MODE);
  }, []);
  const toggleMode = useCallback(() => {
    if (keyboardLayerOpen()) return;
    setMode(nextMode);
  }, []);
  const collapse = useCallback(() => {
    setMiniMode(true);
  }, []);
  const expand = useCallback(() => {
    setMiniMode(false);
  }, []);

  useEffect(
    () =>
      onEvent("toggle-mini", () => {
        setMiniMode((mini) => !mini);
      }),
    [],
  );

  return {
    miniMode,
    mode,
    notesMode,
    miniModeRef,
    notesModeRef,
    setMode,
    revealChat,
    toggleMode,
    collapse,
    expand,
  };
}
