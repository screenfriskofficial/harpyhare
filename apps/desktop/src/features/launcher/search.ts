import { HOTKEY_ACTIONS, type HotkeyKind } from "@/ipc/bindings";
import { apiKeyInfo, type ApiKeyId } from "@/lib/api-keys";
import { hotkeyAction, type HotkeyActionId } from "@/lib/hotkeys";
import { foldForSearch } from "@/lib/notes-search";
import { PLATFORM, type Platform } from "@/lib/platform";
import { PERMISSION_ROWS } from "./permission-rows";
import { SCREEN_GROUPS, screenGroup, screenMeta, type ScreenId } from "./screens";
import { SETTINGS_TABS, settingsTabMeta, type SettingsTabId } from "./settings-tabs";

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

const STEP_TITLE_SUFFIX = ": шаг";

const WINDOW_STEP_ROWS = [
  {
    action: "move_window",
    hint: "Модификатор со стрелками двигает окно, шаг — на сколько пикселей за нажатие.",
  },
  { action: "resize_window", hint: "Модификатор со стрелками меняет ширину и высоту окна." },
  { action: "scroll_chat", hint: "Прокрутка переписки стрелками вверх и вниз." },
] as const satisfies readonly { action: HotkeyActionId; hint: string }[];

const SETTINGS_ROWS = [
  { title: "Код доступа", hint: "Быстрый путь: заводить ключи не нужно.", tab: "access" },
  {
    title: "Код доступа активен",
    hint: "Отвязка вернёт запросы на ваши ключи API.",
    tab: "access",
  },
  {
    title: "Устройство захвата",
    hint: "Звук снимается с того выхода, который слышите вы.",
    tab: "speech",
  },
  {
    title: "Провайдер распознавания",
    hint: "OpenAI точнее удерживает английские термины в русской речи.",
    tab: "speech",
  },
  {
    title: "Язык распознавания",
    hint: "Распознавание точнее, когда язык задан явно.",
    tab: "speech",
  },
  {
    title: "Перевод на английский",
    hint: "Речь на любом языке приходит в чат по-английски.",
    tab: "speech",
  },
  {
    title: "Фоновый буфер",
    hint: "Подхватывает сказанное за секунды до нажатия записи.",
    tab: "speech",
  },
  { title: "Глубина буфера", hint: "Сколько секунд звука держится в памяти.", tab: "speech" },
  {
    title: "Прикреплять вложения",
    hint: "Быстрое действие отправит картинки из поля ввода вместе с заготовленным промптом.",
    tab: "quick-actions",
  },
  {
    title: "Отправлять сразу после распознавания",
    hint: "Расшифровка уходит в чат без нажатия отправки.",
    tab: "behavior",
  },
  {
    title: "Открывать превью HTML",
    hint: "Если в ответе есть HTML-блок, рядом с чатом открывается панель просмотра.",
    tab: "behavior",
  },
  {
    title: "Суфлёр продолжает с места остановки",
    hint: "Иначе текст каждый раз начинается сверху.",
    tab: "behavior",
  },
  {
    title: "Показывать окно при демонстрации экрана",
    hint: "По умолчанию окно вырезано из захвата — собеседники его не видят. Включите, только если хотите показать его намеренно.",
    tab: "behavior",
  },
  { title: "Тема", hint: "Серая светлее, чёрная контрастнее.", tab: "appearance" },
  {
    title: "Размер шрифта чата",
    hint: "Влияет на текст переписки и код в ответах.",
    tab: "appearance",
  },
  { title: "Прозрачность окна", hint: "Сквозь окно видно то, что под ним.", tab: "appearance" },
] as const satisfies readonly SettingsRow[];

const QUICK_ACTION_HINT =
  "Кнопки над полем ввода: каждая отправляет в чат свой заготовленный промпт.";

const RANK_TITLE_PREFIX = 0;
const RANK_TITLE_INSIDE = 1;
const RANK_HINT = 2;

function hitId(kind: string, key: string): string {
  return [kind, key].join(HIT_ID_SEPARATOR);
}

function breadcrumbOf(screen: ScreenId, tab: SettingsTabId | null): string {
  const label = screenMeta(screen).label;
  return tab === null ? label : [label, settingsTabMeta(tab).label].join(BREADCRUMB_SEPARATOR);
}

function screenHits(platform: Platform): SearchHit[] {
  return SCREEN_GROUPS.flatMap((group) =>
    screenGroup(group, platform).map((screen) => ({
      id: hitId(SCREEN_HIT, screen.id),
      title: screen.label,
      hint: screen.description,
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
        title: action.label,
        hint: action.hint,
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
    title: tab.label,
    hint: tab.description,
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
    title: row.title,
    hint: row.purpose,
    screen: PERMISSIONS_SCREEN,
    tab: null,
    breadcrumb: breadcrumbOf(PERMISSIONS_SCREEN, null),
  }));
}

function contextDocHits(contextDocs: SearchSources["contextDocs"]): SearchHit[] {
  const hint = screenMeta(CONTEXTS_SCREEN).description;
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
    return { title: `Ключ ${info.name}`, hint: `Нужен для ${info.purpose}.`, tab: "access" };
  });
}

function windowStepRows(): SettingsRow[] {
  return WINDOW_STEP_ROWS.map(({ action, hint }): SettingsRow => ({
    title: `${hotkeyAction(action).label}${STEP_TITLE_SUFFIX}`,
    hint,
    tab: "window",
  }));
}

function quickActionComboRow(): SettingsRow {
  return {
    title: "Сочетание",
    hint: hotkeyAction("quick_action").hint,
    tab: QUICK_ACTIONS_TAB,
  };
}

function settingsRowHits(apiKeys: SearchSources["apiKeys"]): SearchHit[] {
  return [...SETTINGS_ROWS, quickActionComboRow(), ...apiKeyRows(apiKeys), ...windowStepRows()].map(
    (row) => ({
      id: hitId(SETTING_HIT, [row.tab, row.title].join(HIT_ID_SEPARATOR)),
      title: row.title,
      hint: row.hint,
      screen: SETTINGS_SCREEN,
      tab: row.tab,
      breadcrumb: breadcrumbOf(SETTINGS_SCREEN, row.tab),
    }),
  );
}

function presetHits(presets: SearchSources["presets"]): SearchHit[] {
  const hint = screenMeta(PRESETS_SCREEN).description;
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
      hint: QUICK_ACTION_HINT,
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
