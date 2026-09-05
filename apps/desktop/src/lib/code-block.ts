import { t } from "@/i18n";

const TRAILING_NEWLINE = /\n$/;
const LANGUAGE_CLASS_PREFIX = "language-";
const HIGHLIGHT_META_LANGUAGES = new Set(["hljs", "undefined", "plaintext", "text"]);

export function codeLineCount(code: string): number {
  return code.replace(TRAILING_NEWLINE, "").split("\n").length;
}

/**
 * «1 строка», «3 строки», «12 строк» — иначе число под кодом читается как
 * опечатка. Формы выбирает `Intl.PluralRules` текущего языка через словарь,
 * своей арифметики склонений здесь больше нет.
 */
export function linesLabel(count: number): string {
  return t("units.lines", { count });
}

/**
 * `language-go` из класса код-элемента. rehype-highlight дописывает туда же
 * служебные токены (`hljs`) и подставляет `plaintext` там, где язык не опознан,
 * — такие подписи бесполезны и отбрасываются.
 */
export function languageFromClassName(className: string | undefined): string | null {
  if (className === undefined) return null;
  for (const token of className.split(/\s+/)) {
    if (!token.startsWith(LANGUAGE_CLASS_PREFIX)) continue;
    const language = token.slice(LANGUAGE_CLASS_PREFIX.length).toLowerCase();
    if (language !== "" && !HIGHLIGHT_META_LANGUAGES.has(language)) return language;
  }
  return null;
}
