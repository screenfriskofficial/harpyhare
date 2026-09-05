import { isRecord } from "@/lib/utils";

/**
 * One key, every grammatical form a language needs for a count. Russian uses
 * `one`/`few`/`many`, English only `one`/`other`; `other` is the form
 * `Intl.PluralRules` falls back to, so it is the one form every language must
 * supply. Authored as an object rather than four sibling keys so a dictionary
 * that forgets a form fails to compile instead of printing the key at runtime.
 */
export interface PluralForms {
  one: string;
  few?: string;
  many?: string;
  other: string;
}

/** Marks a dictionary leaf as plural; `typeof ru` then types it as `PluralForms`. */
export const plural = (forms: PluralForms): PluralForms => forms;

type PluralSuffix = keyof PluralForms;

/** i18next reads plural forms as `key_one`, `key_few`, … — the separator it expects. */
export const PLURAL_SEPARATOR = "_";

/**
 * The dictionary as i18next sees it: nested objects stay nested, a `PluralForms`
 * leaf becomes `key_one`/`key_few`/`key_many`/`key_other` siblings. The type is
 * what `CustomTypeOptions.resources` is fed, so `t("units.chars", {count})`
 * type-checks against the same shape `toResources` produces at runtime.
 */
export type Resources<T> = {
  [
    K in keyof T as T[K] extends PluralForms
      ? `${K & string}${typeof PLURAL_SEPARATOR}${PluralSuffix}`
      : K
  ]: T[K] extends PluralForms ? string : T[K] extends string ? string : Resources<T[K]>;
};

function isPluralForms(value: unknown): value is PluralForms {
  return isRecord(value) && typeof value["one"] === "string" && typeof value["other"] === "string";
}

export function toResources(dictionary: object): Record<string, unknown> {
  const resources: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(dictionary)) {
    if (typeof value === "string") {
      resources[key] = value;
    } else if (isPluralForms(value)) {
      for (const [form, text] of Object.entries(value)) {
        resources[`${key}${PLURAL_SEPARATOR}${form}`] = text;
      }
    } else if (isRecord(value)) {
      resources[key] = toResources(value);
    }
  }
  return resources;
}
