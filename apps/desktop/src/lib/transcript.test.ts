import i18next from "i18next";
import { describe, expect, it } from "vitest";
import { formatTranscript } from "./transcript";

describe("source-labelled transcripts", () => {
  it("keeps system-only text unchanged", () => {
    expect(
      formatTranscript({ separated: false, segments: [{ source: "system", text: " Question " }] }),
    ).toBe("Question");
  });
  it("labels sources even when only the microphone heard speech", () => {
    expect(
      formatTranscript({ separated: true, segments: [{ source: "microphone", text: "Ответ" }] }),
    ).toBe("Я: Ответ");
  });
  it("preserves both voices and their source order", () => {
    expect(
      formatTranscript({
        separated: true,
        segments: [
          { source: "system", text: "Вопрос" },
          { source: "microphone", text: "Ответ" },
        ],
      }),
    ).toBe("Собеседующий: Вопрос\n\nЯ: Ответ");
  });
  it("localizes labels independently of the recognition language", async () => {
    await i18next.changeLanguage("en");
    expect(
      formatTranscript({ separated: true, segments: [{ source: "microphone", text: "Ответ" }] }),
    ).toBe("Me: Ответ");
  });
});
