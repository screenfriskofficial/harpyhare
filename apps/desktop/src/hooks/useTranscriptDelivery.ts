import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { RecorderState, Settings } from "@/ipc/types";
import { appendTranscript } from "@/lib/composer";
import type { ChatsApi } from "./useChats";
import { useTranscription } from "./useTranscription";

export interface TranscriptDeliveryInput {
  chatsRef: RefObject<ChatsApi>;
  settingsRef: RefObject<Settings>;
  recorderState: RecorderState;
  /** Sends into a specific chat — the one the recording was started in. */
  dispatchSendTo: (chatId: string, text: string) => void;
  clearSttFeedback: () => void;
  /** Back to the chat, expanded: a transcript is something to work with right now. */
  revealChat: () => void;
}

/**
 * A transcript lands in the chat the recording was STARTED in. PTT is a
 * global hotkey and the text arrives seconds later; by then the user may have
 * switched tabs, and the interviewer's question belongs to the chat it was
 * recorded for, with that chat's preset and history. The id is kept across
 * retries: a retry re-delivers the same recording.
 */
export function useTranscriptDelivery({
  chatsRef,
  settingsRef,
  recorderState,
  dispatchSendTo,
  clearSttFeedback,
  revealChat,
}: TranscriptDeliveryInput): void {
  const recordingChatId = useRef<string | null>(null);
  useEffect(() => {
    if (recorderState === "recording") recordingChatId.current = chatsRef.current.activeId;
  }, [recorderState, chatsRef]);

  useTranscription(
    useCallback(
      (incoming: string) => {
        revealChat();
        const api = chatsRef.current;
        const target = api.chats.find((c) => c.id === recordingChatId.current) ?? api.active;
        if (target.id !== api.activeId) api.selectChat(target.id);
        const merged = appendTranscript(target.draft, incoming);
        api.patchChat(target.id, { draft: merged });
        clearSttFeedback();
        if (settingsRef.current.auto_send) dispatchSendTo(target.id, merged);
      },
      [chatsRef, settingsRef, dispatchSendTo, clearSttFeedback, revealChat],
    ),
  );
}
