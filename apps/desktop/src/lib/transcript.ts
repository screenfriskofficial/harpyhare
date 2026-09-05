import { t } from "@/i18n";
import type { TranscriptReady } from "@/ipc/bindings";

/** Source identity comes from capture, never from a model guessing the speaker. */
export function formatTranscript(transcript: TranscriptReady): string {
  return transcript.segments
    .filter((segment) => segment.text.trim() !== "")
    .map(({ source, text }) =>
      transcript.separated ? `${t(`transcript.${source}`)}: ${text.trim()}` : text.trim(),
    )
    .join("\n\n");
}
