import { t } from "@/i18n";
import {
  DEFAULT_MODEL as GENERATED_DEFAULT_MODEL,
  LLM_PROVIDERS,
  type Effort,
} from "@/ipc/bindings";
import type { ApiKeyId } from "./api-keys";

export interface ModelInfo {
  id: string;
  displayName: string;
  provider: string;
  adaptive: boolean;
  alwaysThinks: boolean;
  codeExec: boolean;
  /** Effort levels the model accepts, weakest first; empty when it takes none. */
  efforts: Effort[];
  /** Reasons only through a token budget: an on/off switch, no levels. */
  budgetThinking: boolean;
  /** The level a request carries when the chat picked none; one of `efforts`. */
  defaultEffort: Effort | null;
}

/** New chats start here. The id is declared in Rust (`llm::DEFAULT_MODEL`). */
export const DEFAULT_MODEL: string = GENERATED_DEFAULT_MODEL;

export interface ModelProvider {
  id: string;
  label: string;
  keyId: ApiKeyId;
  /** What a new chat opens on when this vendor is the one available. */
  defaultModel: string;
}

/**
 * Derived from the generated registry — never hand-written.
 *
 * A vendor added to `llm/registry.rs` shows up in every picker, with its group
 * heading, its offline catalogue and its «нет ключа» lock, without a line of
 * TypeScript. The annotation is load-bearing: specta prints the constant `as
 * const`, so `keyId` arrives as a literal type and assigning it to `ApiKeyId`
 * is checked by `tsc` — a row naming a key the app has no field for fails the
 * build here, at the vendor that introduced it.
 */
export const MODEL_PROVIDERS: readonly ModelProvider[] = LLM_PROVIDERS.map((p) => ({
  id: p.id,
  label: p.label,
  keyId: p.keyId,
  defaultModel: p.defaultModel,
}));

/**
 * Every model the app can name without a credential, tagged with its vendor.
 * Same table the backend serves as its own offline catalogue, so the picker and
 * the router cannot disagree about what exists.
 */
export const FALLBACK_MODELS: ModelInfo[] = LLM_PROVIDERS.flatMap((p) =>
  p.catalog.map((m) => ({
    id: m.id,
    displayName: m.displayName,
    provider: p.id,
    adaptive: m.adaptive,
    alwaysThinks: m.alwaysThinks,
    codeExec: m.codeExec,
    efforts: [...m.efforts],
    budgetThinking: m.budgetThinking,
    defaultEffort: m.defaultEffort,
  })),
);

/**
 * Models of a provider the backend did not report — it has no credential, so
 * `list_models` never saw it. They stay in the list on purpose, locked, so the
 * picker answers "can this app talk to that vendor at all?" instead of staying
 * silent.
 */
export function withLockedModels(reported: ModelInfo[]): ModelInfo[] {
  const answering = new Set(reported.map((m) => m.provider));
  return [...reported, ...FALLBACK_MODELS.filter((m) => !answering.has(m.provider))];
}

function modelsOfProvider(models: ModelInfo[], provider: string): ModelInfo[] {
  return models.filter((m) => m.provider === provider);
}

function modelsOfUnknownProvider(models: ModelInfo[]): ModelInfo[] {
  const known = new Set<string>(MODEL_PROVIDERS.map((p) => p.id));
  return models.filter((m) => !known.has(m.provider));
}

export interface ModelGroup {
  id: string;
  label: string;
  models: ModelInfo[];
}

export function modelGroups(models: ModelInfo[], selectedId?: string): ModelGroup[] {
  const groups = MODEL_PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    models: modelsOfProvider(models, p.id).sort(
      (a, b) => Number(b.id === selectedId) - Number(a.id === selectedId),
    ),
  }));
  const rest = modelsOfUnknownProvider(models);
  const unknown =
    rest.length > 0 ? [{ id: "", label: t("models.otherProvider"), models: rest }] : [];
  return [...groups, ...unknown].filter((g) => g.models.length > 0);
}

const BRAND_PREFIX = /^Claude\s+/i;
const MODEL_ID_PREFIX = /^claude-/;
/** `claude-haiku-4-5` и датированный `claude-haiku-4-5-20251001` — обе формы дают «Haiku 4.5». */
const MODEL_ID_VERSION_SUFFIX = /-(\d+)-(\d+)(?:-\d{8})?$/;
const VERSION_LABEL = " $1.$2";

function capitalizeFirst(s: string): string {
  return s.replace(/^./, (c) => c.toUpperCase());
}

function labelFromModelId(id: string): string {
  return capitalizeFirst(
    id.replace(MODEL_ID_PREFIX, "").replace(MODEL_ID_VERSION_SUFFIX, VERSION_LABEL),
  );
}

export function modelLabel(m: Pick<ModelInfo, "id" | "displayName">): string {
  const short = m.displayName.replace(BRAND_PREFIX, "").trim();
  if (short !== "") return short;
  return labelFromModelId(m.id);
}

function unlistedModel(id: string): ModelInfo {
  return {
    id,
    displayName: id,
    provider: "",
    adaptive: true,
    alwaysThinks: false,
    codeExec: true,
    // Nothing vouches for a level of a model the catalogue does not list.
    efforts: [],
    budgetThinking: false,
    defaultEffort: null,
  };
}

export function selectableModels(models: ModelInfo[], currentId: string): ModelInfo[] {
  if (models.some((m) => m.id === currentId)) return models;
  return [unlistedModel(currentId), ...models];
}

export function thinkingLocked(models: ModelInfo[], currentId: string): boolean {
  const m = models.find((x) => x.id === currentId);
  return m !== undefined && (!(m.adaptive || m.budgetThinking) || m.alwaysThinks);
}

/**
 * A model the user can actually call right now.
 *
 * New chats used to open on `DEFAULT_MODEL` unconditionally, which was fine
 * while Claude was the only vendor. With a key for one vendor and not another,
 * that default is a model the account cannot reach — the chat looks ready and
 * fails on send. Picks the declared default of the first unlocked vendor, in
 * registry order, and only falls back to `DEFAULT_MODEL` when nothing is
 * unlocked (there is no better answer then, and the picker shows why).
 */
export function defaultModelFor(lockedProviderIds: readonly string[]): string {
  const usable = MODEL_PROVIDERS.find((p) => !lockedProviderIds.includes(p.id));
  return usable?.defaultModel ?? DEFAULT_MODEL;
}
