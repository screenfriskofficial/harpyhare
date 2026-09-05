import i18next from "i18next";
import { beforeEach, vi } from "vitest";

const jestTimersShimForTestingLibrary = {
  advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms),
};

(globalThis as Record<string, unknown>)["jest"] = jestTimersShimForTestingLibrary;

function memoryStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear: () => {
      entries.clear();
    },
    getItem: (key: string) => entries.get(key) ?? null,
    key: (index: number) => [...entries.keys()][index] ?? null,
    removeItem: (key: string) => {
      entries.delete(key);
    },
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
  };
}

if (typeof globalThis.localStorage === "undefined") {
  Object.defineProperty(globalThis, "localStorage", {
    value: memoryStorage(),
    configurable: true,
    writable: true,
  });
}

// jsdom reports English system languages; tests assert the source-language
// text, so every test starts in it regardless of the machine it runs on.
// Load bindings after each test file has installed its Tauri mocks.
beforeEach(async () => {
  const { SOURCE_LANGUAGE } = await import("@/i18n");
  await i18next.changeLanguage(SOURCE_LANGUAGE);
});
