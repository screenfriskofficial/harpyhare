import { useEffect, useMemo } from "react";
import { onEvent } from "@/ipc/events";
import type { HotkeyBinding } from "@/ipc/types";
import {
  matchesModifier,
  matchesPrepared,
  parseFamilyModifier,
  prepareCombo,
  type ModifierState,
} from "@/lib/hotkey-match";
import { effectiveCombo } from "@/lib/hotkeys";
import { type WindowDimension } from "@/lib/window-size";
import { useLatestRef } from "./useLatestRef";

const KEYDOWN_EVENT = "keydown";
const OPACITY_UP_CODE = "Equal";
const OPACITY_DOWN_CODE = "Minus";
const FONT_UP_CODE = "BracketRight";
const FONT_DOWN_CODE = "BracketLeft";

type ResizeKeyHandler = (dim: WindowDimension, dir: 1 | -1) => void;

function familyStepFromEvent(
  e: KeyboardEvent,
  expected: ModifierState | null,
  upCode: string,
  downCode: string,
): 1 | -1 | null {
  if (expected === null || !matchesModifier(e, expected)) return null;
  if (e.code === upCode) return 1;
  if (e.code === downCode) return -1;
  return null;
}

export function useWindowControls(
  hotkeys: HotkeyBinding[],
  onSend: () => void,
  onOpacityStep: (dir: 1 | -1) => void,
  onChatFontStep: (dir: 1 | -1) => void,
  onResizeKey: ResizeKeyHandler,
): void {
  // Колбэки читаются из ref, подписки ставятся один раз: переподписка на
  // смену идентичности колбэка снимала бы `unlisten` синхронно, а новый
  // `listen` вставал бы после round-trip в Rust — событие в зазоре терялось бы.
  const onResizeKeyRef = useLatestRef(onResizeKey);
  const onSendRef = useLatestRef(onSend);
  const onOpacityStepRef = useLatestRef(onOpacityStep);
  const onChatFontStepRef = useLatestRef(onChatFontStep);

  useEffect(
    () =>
      onEvent("resize-key", ({ dim, dir }) => {
        onResizeKeyRef.current(dim, dir);
      }),
    [onResizeKeyRef],
  );

  const opacityModifier = effectiveCombo(hotkeys, "opacity");
  const chatFontModifier = effectiveCombo(hotkeys, "chat_font_size");
  const sendCombo = effectiveCombo(hotkeys, "send");
  const opacityState = useMemo(() => parseFamilyModifier(opacityModifier), [opacityModifier]);
  const chatFontState = useMemo(() => parseFamilyModifier(chatFontModifier), [chatFontModifier]);
  const preparedSend = useMemo(() => prepareCombo(sendCombo), [sendCombo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const opacityDir = familyStepFromEvent(e, opacityState, OPACITY_UP_CODE, OPACITY_DOWN_CODE);
      if (opacityDir !== null) {
        e.preventDefault();
        onOpacityStepRef.current(opacityDir);
        return;
      }
      const fontDir = familyStepFromEvent(e, chatFontState, FONT_UP_CODE, FONT_DOWN_CODE);
      if (fontDir !== null) {
        e.preventDefault();
        onChatFontStepRef.current(fontDir);
        return;
      }
      if (matchesPrepared(e, preparedSend)) {
        e.preventDefault();
        onSendRef.current();
      }
    };
    document.addEventListener(KEYDOWN_EVENT, onKey);
    return () => {
      document.removeEventListener(KEYDOWN_EVENT, onKey);
    };
  }, [onSendRef, onOpacityStepRef, onChatFontStepRef, opacityState, chatFontState, preparedSend]);
}
