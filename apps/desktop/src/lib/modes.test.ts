import { describe, expect, it } from "vitest";
import { APP_MODES, DEFAULT_MODE, modeHint, modeLabel, nextMode } from "./modes";

describe("modes", () => {
  it("стартовый режим — чат", () => {
    expect(DEFAULT_MODE).toBe("chat");
  });

  it("следующий режим ходит по кругу реестра", () => {
    let mode = DEFAULT_MODE;
    const visited = APP_MODES.map(() => {
      const current = mode;
      mode = nextMode(mode);
      return current;
    });
    expect(visited).toEqual(APP_MODES.map((m) => m.id));
    expect(mode).toBe(DEFAULT_MODE);
  });

  it("неизвестный режим откатывается на стартовый", () => {
    expect(nextMode("nope" as never)).toBe(DEFAULT_MODE);
  });

  it("у каждого режима есть подпись и подсказка", () => {
    for (const mode of APP_MODES) {
      expect(modeLabel(mode.id).trim()).not.toBe("");
      expect(modeHint(mode.id).trim()).not.toBe("");
    }
  });
});
