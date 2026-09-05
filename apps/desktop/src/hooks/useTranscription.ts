import { useEffect } from "react";
import { onEvent } from "@/ipc/events";
import { useLatestRef } from "./useLatestRef";

/**
 * Подписка ставится один раз, колбэк читается из ref: `listen` в Tauri
 * регистрирует обработчик асинхронным round-trip в Rust, и переподписка на
 * смену колбэка оставляла бы окно, в котором расшифровка теряется — а это
 * единственный канал её доставки.
 */
export function useTranscription(onText: (text: string) => void): void {
  const onTextRef = useLatestRef(onText);
  useEffect(
    () =>
      onEvent("transcript-ready", (text) => {
        onTextRef.current(text);
      }),
    [onTextRef],
  );
}
