import i18next from "i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HOTKEY_ACTIONS, UI_LANGUAGES } from "@/ipc/bindings";
import { applyUiLanguage, currentUiLanguage, resolveUiLanguage, t } from "./index";
import { en } from "./en";
import { ru } from "./ru";
import { toResources } from "./types";

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.removeAttribute("lang");
});

describe("UI language", () => {
  it.each([
    ["ru", ["en-US"], "ru"],
    ["en", ["ru-RU"], "en"],
    ["", ["ru-RU", "en-US"], "ru"],
    ["", ["de-DE", "EN-gb", "ru"], "en"],
    ["", ["fr-FR"], "en"],
    ["invalid", ["ru-RU"], "ru"],
    ["", [], "en"],
  ])("resolves %s with %j to %s", (setting, system, expected) => {
    expect(resolveUiLanguage(setting, system)).toBe(expected);
  });

  it("applies an explicit language and can return to the system preference", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["ru-RU"]);
    applyUiLanguage(document.documentElement, "en");
    expect(document.documentElement.lang).toBe("en");
    expect(currentUiLanguage()).toBe("en");
    expect(t("common.close")).toBe("Close");
    applyUiLanguage(document.documentElement, "");
    expect(document.documentElement.lang).toBe("ru");
    expect(t("common.close")).toBe("Закрыть");
  });

  it.each([
    ["ru", ["0 строк", "1 строка", "2 строки", "5 строк", "11 строк", "21 строка"]],
    ["en", ["0 lines", "1 line", "2 lines", "5 lines", "11 lines", "21 lines"]],
  ])("uses grammatical count forms in %s", async (language, expected) => {
    await i18next.changeLanguage(language);
    expect([0, 1, 2, 5, 11, 21].map((count) => t("units.lines", { count }))).toEqual(expected);
  });

  it("keeps Russian hotkey labels and hints aligned with the backend registry", () => {
    for (const action of HOTKEY_ACTIONS) {
      expect(ru.hotkeys.actions[action.id]).toEqual({ label: action.label, hint: action.hint });
    }
  });

  it("preserves interpolation variables and supplies every language's plural forms", () => {
    function leaves(tree: object, prefix = ""): [string, string][] {
      return Object.entries(tree).flatMap(([key, value]: [string, unknown]) => {
        const path = prefix === "" ? key : `${prefix}.${key}`;
        return typeof value === "string"
          ? [[path, value] as [string, string]]
          : leaves(value as object, path);
      });
    }
    const dictionaries = { ru, en };
    const reference = new Map(leaves(toResources(ru)));
    const variables = (text: string) =>
      [...text.matchAll(/{{\s*([^}, ]+)/g)].map((match) => match[1]).sort();
    for (const language of UI_LANGUAGES) {
      const resources = new Map(leaves(toResources(dictionaries[language])));
      for (const [key, source] of reference) {
        const base = key.replace(/_(one|few|many|other)$/, "");
        const keys =
          base === key
            ? [key]
            : new Intl.PluralRules(language)
                .resolvedOptions()
                .pluralCategories.map((form) => `${base}_${form}`);
        for (const translatedKey of keys) {
          const translated = resources.get(translatedKey);
          expect(translated, `${language}:${translatedKey}`).toBeTypeOf("string");
          expect(variables(translated ?? ""), `${language}:${translatedKey}`).toEqual(
            variables(source),
          );
        }
      }
    }
  });
});
