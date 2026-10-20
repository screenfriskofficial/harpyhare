import { t } from "@/i18n";
import { EFFORT_LEVELS, type Effort } from "@/ipc/bindings";
import type { Chat, ChatPatch } from "@/lib/chats";
import type { ModelInfo } from "@/lib/models";

/**
 * One reasoning control, shaped like claude.ai's: a model with effort levels
 * offers exactly those levels (and «off» only where the vendor has an off
 * value the model takes — GPT's `none`); a model that reasons through a token
 * budget is a switch. The chat keeps two fields behind it (`thinkingEnabled`,
 * `effort`) — the pipelines and the thinking switch read the first alone — but
 * the picker shows them as one choice.
 */
export type EffortChoice = "off" | "on" | Effort;

export interface EffortMenu {
  choices: EffortChoice[];
  /** What the next request will actually carry, not merely what was saved. */
  current: EffortChoice;
  /** The level sent when the chat picked none, marked «по умолчанию». */
  defaultLevel: Effort | null;
  /** Reasoning here is a switch (a token budget), not a ladder. */
  toggle: boolean;
  /** The model does not reason at all — nothing here would change a request. */
  disabled: boolean;
}

/** How many of the meter's bars a level fills: its rank on the ladder. */
export const EFFORT_METER_BARS = EFFORT_LEVELS.length;

export function effortRank(effort: Effort): number {
  return EFFORT_LEVELS.indexOf(effort) + 1;
}

function switchMenu(chat: Pick<Chat, "thinkingEnabled">): EffortMenu {
  return {
    choices: ["off", "on"],
    current: chat.thinkingEnabled ? "on" : "off",
    defaultLevel: null,
    toggle: true,
    disabled: false,
  };
}

/**
 * A model missing from the list (a saved id outside the catalogue) is a
 * switch: reasoning can be toggled, no level is vouched for.
 */
export function effortMenu(
  model: ModelInfo | undefined,
  chat: Pick<Chat, "thinkingEnabled" | "effort">,
): EffortMenu {
  if (model === undefined) return switchMenu(chat);
  const reasons = model.alwaysThinks || model.adaptive || model.budgetThinking;
  if (!reasons) {
    return { choices: [], current: "off", defaultLevel: null, toggle: false, disabled: true };
  }
  const levels = model.efforts;
  const defaultLevel = model.defaultEffort ?? levels[0];
  if (defaultLevel === undefined) return switchMenu(chat);
  const level =
    chat.effort !== undefined && levels.includes(chat.effort) ? chat.effort : defaultLevel;
  const off = !model.alwaysThinks && !chat.thinkingEnabled;
  return {
    choices: [...(model.alwaysThinks ? [] : ["off" as const]), ...levels],
    current: off ? "off" : level,
    defaultLevel,
    toggle: false,
    disabled: false,
  };
}

/** Picking a level or «on» switches reasoning on: that is what picking it means. */
export function effortPatch(choice: EffortChoice): ChatPatch {
  if (choice === "off") return { thinkingEnabled: false };
  if (choice === "on") return { thinkingEnabled: true };
  return { thinkingEnabled: true, effort: choice };
}

export function effortChoiceLabel(choice: EffortChoice): string {
  return t(`hud.effort.choice.${choice}`);
}
