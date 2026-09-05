import { useEffect } from "react";
import { onEvent } from "@/ipc/events";
import { notifyAppError } from "@/lib/notify";

export function useErrorToasts(): void {
  useEffect(() => onEvent("stt-error", notifyAppError), []);
  useEffect(() => onEvent("screenshot-error", notifyAppError), []);
  useEffect(() => onEvent("hotkey-error", notifyAppError), []);
  useEffect(
    () =>
      onEvent("llm-error", ({ code, message }) => {
        notifyAppError({ code, message });
      }),
    [],
  );
}
