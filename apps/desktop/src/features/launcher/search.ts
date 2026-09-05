import { t, type TranslationKey } from "@/i18n";
import { HOTKEY_ACTIONS, type HotkeyKind } from "@/ipc/bindings";
import { apiKeyInfo, type ApiKeyId } from "@/lib/api-keys";
import { actionLabel, actionHint, type HotkeyActionId } from "@/lib/hotkeys";
import { foldForSearch } from "@/lib/notes-search";
import { PLATFORM, type Platform } from "@/lib/platform";
import { PERMISSION_ROWS, permissionTitle, permissionPurpose } from "./permission-rows";
import {
  SCREEN_GROUPS,
  screenGroup,
  screenLabel,
  screenDescription,
  type ScreenId,
} from "./screens";
import {
  SETTINGS_TABS,
  settingsTabLabel,
  settingsTabDescription,
  type SettingsTabId,
} from "./settings-tabs";

export interface SearchHit {
  id: string;
  title: string;
  hint: string;
  screen: ScreenId;
  tab: SettingsTabId | null;
  breadcrumb: string;
}

export interface SearchSources {
  presets: { id: string; name: string }[];
  quickActions: { id: string; title: string }[];
  contextDocs: { id: string; name: string }[];
  apiKeys: readonly ApiKeyId[];
}

interface SettingsRow {
  title: string;
  hint: string;
  tab: SettingsTabId;
}

const BREADCRUMB_SEPARATOR = " → ";
const HIT_ID_SEPARATOR = ":";

const SCREEN_HIT = "screen";
const TAB_HIT = "tab";
const HOTKEY_HIT = "hotkey";
const SETTING_HIT = "setting";
const PERMISSION_HIT = "permission";
const PRESET_HIT = "preset";
const QUICK_ACTION_HIT = "quickAction";
const CONTEXT_DOC_HIT = "contextDoc";

const SETTINGS_SCREEN: ScreenId = "settings";
const PRESETS_SCREEN: ScreenId = "presets";
const PERMISSIONS_SCREEN: ScreenId = "permissions";
const CONTEXTS_SCREEN: ScreenId = "contexts";
const QUICK_ACTIONS_TAB: SettingsTabId = "quick-actions";

const TAB_BY_HOTKEY_KIND: Record<HotkeyKind, SettingsTabId> = {
  combo: "hotkeys",
  modifier_arrows: "window",
  modifier_plus_minus: "window",
  modifier_brackets: "appearance",
  modifier_digits: "quick-actions",
};

const HOTKEYS_WITHOUT_SETTINGS_ROW: ReadonlySet<HotkeyActionId> = new Set([
  "opacity",
  "chat_font_size",
]);

const WINDOW_STEP_ACTIONS = ["move_window", "resize_window", "scroll_chat"] as const;

// Reuse the visible field copy so search follows the interface language.
const SETTINGS_ROWS = [
  { title: "launcher.access.code", hint: "launcher.access.codeHint", tab: "access" },
  { title: "launcher.access.codeActive", hint: "launcher.access.unlinkHint", tab: "access" },
  { title: "launcher.speech.device", hint: "launcher.speech.deviceHint", tab: "speech" },
  { title: "launcher.speech.provider", hint: "launcher.speech.providerHint", tab: "speech" },
  { title: "launcher.speech.language", hint: "launcher.speech.languageHint", tab: "speech" },
  { title: "launcher.speech.translate", hint: "launcher.speech.translateHint", tab: "speech" },
  { title: "launcher.speech.buffer", hint: "launcher.speech.bufferHint", tab: "speech" },
  { title: "launcher.speech.bufferDepth", hint: "launcher.speech.bufferDepthHint", tab: "speech" },
  {
    title: "launcher.quickActions.attachments",
    hint: "launcher.quickActions.attachmentsHint",
    tab: "quick-actions",
  },
  { title: "launcher.behavior.autoSend", hint: "launcher.behavior.autoSendHint", tab: "behavior" },
  {
    title: "launcher.behavior.autoPreview",
    hint: "launcher.behavior.autoPreviewHint",
    tab: "behavior",
  },
  {
    title: "launcher.behavior.teleprompterResume",
    hint: "launcher.behavior.teleprompterResumeHint",
    tab: "behavior",
  },
  {
    title: "launcher.behavior.screenShare",
    hint: "launcher.behavior.screenShareHint",
    tab: "behavior",
  },
  { title: "launcher.appearance.theme", hint: "launcher.appearance.themeHint", tab: "appearance" },
  {
    title: "launcher.appearance.language",
    hint: "launcher.appearance.languageHint",
    tab: "appearance",
  },
  {
    title: "launcher.appearance.fontSize",
    hint: "launcher.appearance.fontSizeHint",
    tab: "appearance",
  },
  {
    title: "launcher.appearance.opacity",
    hint: "launcher.appearance.opacityHint",
    tab: "appearance",
  },
] as const satisfies readonly { title: TranslationKey; hint: TranslationKey; tab: SettingsTabId }[];

const RANK_TITLE_PREFIX = 0;
const RANK_TITLE_INSIDE = 1;
const RANK_HINT = 2;

function hitId(kind: string, key: string): string {
  return [kind, key].join(HIT_ID_SEPARATOR);
}

function breadcrumbOf(screen: ScreenId, tab: SettingsTabId | null): string {
  const label = screenLabel(screen);
  return tab === null ? label : [label, settingsTabLabel(tab)].join(BREADCRUMB_SEPARATOR);
}

function screenHits(platform: Platform): SearchHit[] {
  return SCREEN_GROUPS.flatMap((group) =>
    screenGroup(group, platform).map((screen) => ({
      id: hitId(SCREEN_HIT, screen.id),
      title: screenLabel(screen.id),
      hint: screenDescription(screen.id),
      screen: screen.id,
      tab: null,
      breadcrumb: breadcrumbOf(screen.id, null),
    })),
  );
}

function hotkeyHits(): SearchHit[] {
  return HOTKEY_ACTIONS.filter((action) => !HOTKEYS_WITHOUT_SETTINGS_ROW.has(action.id)).map(
    (action) => {
      const tab = TAB_BY_HOTKEY_KIND[action.kind];
      return {
        id: hitId(HOTKEY_HIT, action.id),
        title: actionLabel(action.id),
        hint: actionHint(action.id),
        screen: SETTINGS_SCREEN,
        tab,
        breadcrumb: breadcrumbOf(SETTINGS_SCREEN, tab),
      };
    },
  );
}

function tabHits(): SearchHit[] {
  return SETTINGS_TABS.map((tab) => ({
    id: hitId(TAB_HIT, tab.id),
    title: settingsTabLabel(tab.id),
    hint: settingsTabDescription(tab.id),
    screen: SETTINGS_SCREEN,
    tab: tab.id,
    breadcrumb: breadcrumbOf(SETTINGS_SCREEN, tab.id),
  }));
}

function permissionHits(platform: Platform): SearchHit[] {
  const visible = screenGroup("system", platform).some((s) => s.id === PERMISSIONS_SCREEN);
  if (!visible) return [];
  return PERMISSION_ROWS.map((row) => ({
    id: hitId(PERMISSION_HIT, row.kind),
    title: permissionTitle(row.kind),
    hint: permissionPurpose(row.kind),
    screen: PERMISSIONS_SCREEN,
    tab: null,
    breadcrumb: breadcrumbOf(PERMISSIONS_SCREEN, null),
  }));
}

function contextDocHits(contextDocs: SearchSources["contextDocs"]): SearchHit[] {
  const hint = screenDescription(CONTEXTS_SCREEN);
  return contextDocs
    .filter((doc) => doc.name.trim() !== "")
    .map((doc) => ({
      id: hitId(CONTEXT_DOC_HIT, doc.id),
      title: doc.name,
      hint,
      screen: CONTEXTS_SCREEN,
      tab: null,
      breadcrumb: breadcrumbOf(CONTEXTS_SCREEN, null),
    }));
}

function apiKeyRows(apiKeys: SearchSources["apiKeys"]): SettingsRow[] {
  return apiKeys.map((id): SettingsRow => {
    const info = apiKeyInfo(id);
    return {
      title: t("apiKeys.keyLabel", { name: info.name }),
      hint: t("apiKeys.keyHint", { purpose: info.purpose }),
      tab: "access",
    };
  });
}

function windowStepRows(): SettingsRow[] {
  return WINDOW_STEP_ACTIONS.map((action): SettingsRow => ({
    title: t("launcher.window.stepAria", { action: actionLabel(action) }),
    hint: t(`launcher.window.pairs.${action}`),
    tab: "window",
  }));
}

function quickActionComboRow(): SettingsRow {
  return {
    title: t("launcher.quickActions.combo"),
    hint: actionHint("quick_action"),
    tab: QUICK_ACTIONS_TAB,
  };
}

function settingsRowHits(apiKeys: SearchSources["apiKeys"]): SearchHit[] {
  return [
    ...SETTINGS_ROWS.map((row) => ({ ...row, title: t(row.title), hint: t(row.hint) })),
    quickActionComboRow(),
    ...apiKeyRows(apiKeys),
    ...windowStepRows(),
  ].map((row) => ({
    id: hitId(SETTING_HIT, [row.tab, row.title].join(HIT_ID_SEPARATOR)),
    title: row.title,
    hint: row.hint,
    screen: SETTINGS_SCREEN,
    tab: row.tab,
    breadcrumb: breadcrumbOf(SETTINGS_SCREEN, row.tab),
  }));
}

function presetHits(presets: SearchSources["presets"]): SearchHit[] {
  const hint = screenDescription(PRESETS_SCREEN);
  return presets
    .filter((preset) => preset.name.trim() !== "")
    .map((preset) => ({
      id: hitId(PRESET_HIT, preset.id),
      title: preset.name,
      hint,
      screen: PRESETS_SCREEN,
      tab: null,
      breadcrumb: breadcrumbOf(PRESETS_SCREEN, null),
    }));
}

function quickActionHits(quickActions: SearchSources["quickActions"]): SearchHit[] {
  return quickActions
    .filter((action) => action.title.trim() !== "")
    .map((action) => ({
      id: hitId(QUICK_ACTION_HIT, action.id),
      title: action.title,
      hint: t("launcher.quickActions.description"),
      screen: SETTINGS_SCREEN,
      tab: QUICK_ACTIONS_TAB,
      breadcrumb: breadcrumbOf(SETTINGS_SCREEN, QUICK_ACTIONS_TAB),
    }));
}

function launcherIndex(sources: SearchSources, platform: Platform): SearchHit[] {
  return [
    ...screenHits(platform),
    ...tabHits(),
    ...hotkeyHits(),
    ...settingsRowHits(sources.apiKeys),
    ...permissionHits(platform),
    ...presetHits(sources.presets),
    ...quickActionHits(sources.quickActions),
    ...contextDocHits(sources.contextDocs),
  ];
}

/** Та же свёртка, что у поиска по заметкам: «елка» находит и пресет «Ёлка». */
const folded = foldForSearch;

function rankOf(hit: SearchHit, needle: string): number | null {
  const title = folded(hit.title);
  if (title.startsWith(needle)) return RANK_TITLE_PREFIX;
  if (title.includes(needle)) return RANK_TITLE_INSIDE;
  if (folded(hit.hint).includes(needle)) return RANK_HINT;
  return null;
}

export function searchLauncher(
  query: string,
  sources: SearchSources,
  platform: Platform = PLATFORM,
): SearchHit[] {
  const needle = folded(query.trim());
  if (needle === "") return [];
  const ranked: { hit: SearchHit; rank: number }[] = [];
  for (const hit of launcherIndex(sources, platform)) {
    const rank = rankOf(hit, needle);
    if (rank !== null) ranked.push({ hit, rank });
  }
  ranked.sort((a, b) => a.rank - b.rank);
  return ranked.map((entry) => entry.hit);
}
