import i18next, { type ParseKeys } from "i18next";
import { initReactI18next } from "react-i18next";
import { SETTINGS_DEFAULTS, UI_LANGUAGES } from "@/ipc/bindings";
import { en } from "./en";
import { ru, type Dictionary } from "./ru";
import { toResources, type Resources } from "./types";

/**
 * Typed keys: `t("launcher.tabs.access.label")` autocompletes and a typo fails
 * `tsc`. The augmentation lives here rather than in a `.d.ts` so it cannot be
 * forgotten when the module is moved — every consumer of `t` imports this file.
 */
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: typeof DEFAULT_NAMESPACE;
    resources: { translation: Resources<Dictionary> };
    returnNull: false;
  }
}

const DEFAULT_NAMESPACE = "translation";

/** The languages the app is translated into — the vocabulary of `Settings.ui_language`, owned by Rust. */
export type UiLanguage = (typeof UI_LANGUAGES)[number];

/** Any leaf key of the dictionary, for registries that name a key instead of a string. */
export type TranslationKey = ParseKeys;

/**
 * `""` — follow the system, the value Rust keeps in `Settings::default()`.
 * Derived from the generated defaults rather than repeated: a mismatch would
 * make the launcher's select show nothing for a freshly installed app.
 */
export const UI_LANGUAGE_SYSTEM = SETTINGS_DEFAULTS.ui_language;

/**
 * The language every key is authored in first; i18next falls back to it for a
 * key a dictionary lacks, and tests pin it so assertions read the source text.
 */
export const SOURCE_LANGUAGE: UiLanguage = "ru";

/** What a system that speaks none of our languages gets. */
const INTERNATIONAL_LANGUAGE: UiLanguage = "en";

/**
 * `Record<UiLanguage, …>` is the compile-time seam between the two owners: Rust
 * lists the languages, TypeScript holds the dictionaries, and a language added
 * to one side without the other fails here.
 */
const DICTIONARIES: Record<UiLanguage, Dictionary> = { ru, en };

const LANGUAGE_TAG_SEPARATOR = "-";

export function isUiLanguage(value: string): value is UiLanguage {
  return (UI_LANGUAGES as readonly string[]).includes(value);
}

function primarySubtag(languageTag: string): string {
  return languageTag.toLowerCase().split(LANGUAGE_TAG_SEPARATOR)[0] ?? "";
}

/**
 * Explicit setting wins; otherwise the first system language we speak, matched
 * on the primary subtag (`ru-RU` → `ru`); otherwise English.
 */
export function resolveUiLanguage(setting: string, systemLanguages: readonly string[]): UiLanguage {
  if (isUiLanguage(setting)) return setting;
  for (const tag of systemLanguages) {
    const primary = primarySubtag(tag);
    if (isUiLanguage(primary)) return primary;
  }
  return INTERNATIONAL_LANGUAGE;
}

function systemLanguages(): readonly string[] {
  return navigator.languages.length > 0 ? navigator.languages : [navigator.language];
}

void i18next.use(initReactI18next).init({
  resources: Object.fromEntries(
    UI_LANGUAGES.map((language) => [
      language,
      { [DEFAULT_NAMESPACE]: toResources(DICTIONARIES[language]) },
    ]),
  ),
  lng: resolveUiLanguage(UI_LANGUAGE_SYSTEM, systemLanguages()),
  fallbackLng: SOURCE_LANGUAGE,
  defaultNS: DEFAULT_NAMESPACE,
  // React escapes on render; escaping here too would show `&quot;` in labels.
  interpolation: { escapeValue: false },
  returnNull: false,
  // Resources are inline, so init is synchronous and `t` works from the first render.
  initAsync: false,
});

/**
 * Applies `Settings.ui_language` to a window: switches the dictionary (every
 * `useTranslation` consumer re-renders) and stamps `<html lang>` so hyphenation,
 * spellcheck and `Intl` formatting follow. Called from the same place the
 * theme is applied — both windows, on load and after every save.
 */
export function applyUiLanguage(root: HTMLElement, setting: string): void {
  const language = resolveUiLanguage(setting, systemLanguages());
  root.lang = language;
  if (i18next.language !== language) void i18next.changeLanguage(language);
}

/** The current language, for `Intl` formatters and `localeCompare` outside React. */
export function currentUiLanguage(): UiLanguage {
  const language = i18next.language;
  return isUiLanguage(language) ? language : SOURCE_LANGUAGE;
}

/**
 * The framework-free `t` for `lib/` and hooks: same typed keys as
 * `useTranslation().t`, resolved at call time — never call it at module
 * top level, a constant computed on import would freeze the startup language.
 */
export const t = i18next.t;
