export interface DemoMessageSeed {
  role: "user" | "assistant";
  text: string;
}

/** Ответы на три быстрых действия HUD поверх последнего ответа в чате. */
export interface FollowUps {
  more: string;
  shorter: string;
  code: string;
}

export interface DemoChatSeed {
  id: string;
  title: string;
  messages: DemoMessageSeed[];
  followUps: FollowUps | null;
}

export interface VoicePrompt {
  chip: string;
  question: string;
  answer: string;
  followUps: FollowUps;
}

export type QuickActionId = keyof FollowUps;

export interface QuickActionCopy {
  id: QuickActionId;
  /** Подпись на кнопке; в чат уходит `prompt`. */
  title: string;
  prompt: string;
}

export interface ScreenCopy {
  label: string;
  description: string;
}

export interface SettingGroupCopy {
  title: string;
  description?: string;
}

export interface HotkeyRowCopy {
  label: string;
  hint?: string;
  combo: string;
}

export interface HotkeyGroupCopy {
  title: string;
  rows: { label: string; combo: string }[];
}

export interface PermissionCopy {
  id: string;
  label: string;
  hint: string;
  required: boolean;
}

export interface PresetCopy {
  name: string;
  text: string;
}

export interface LibraryDocCopy {
  id: string;
  name: string;
  size: string;
  folder: string;
  /** Текст заметки: его показывает режим заметок и по нему идёт поиск. */
  text: string;
}

export interface ModelOptionCopy {
  id: string;
  label: string;
}

export interface ModelGroupCopy {
  id: string;
  label: string;
  /** Вендор без ключа: модели видны, но заперты. */
  locked: boolean;
  models: ModelOptionCopy[];
}

export interface VoiceModelCopy {
  id: string;
  label: string;
  locked: boolean;
}

export interface LauncherCopy {
  statusReady: string;
  statusLaunching: string;
  launch: string;
  launching: string;
  screens: {
    contexts: ScreenCopy;
    presets: ScreenCopy;
    settings: ScreenCopy;
    permissions: ScreenCopy;
    updates: ScreenCopy;
  };
  settings: {
    groups: {
      api: SettingGroupCopy;
      stt: SettingGroupCopy;
      hotkeys: SettingGroupCopy;
      window: SettingGroupCopy;
      behavior: SettingGroupCopy;
      appearance: SettingGroupCopy;
    };
    anthropicKey: string;
    groqKey: string;
    groqKeyHint: string;
    language: string;
    languages: string[];
    translate: string;
    captureDevice: string;
    captureDevices: string[];
    buffer: string;
    bufferHint: string;
    bufferLength: string;
    secondsUnit: string;
    hotkeys: HotkeyRowCopy[];
    moveModifier: string;
    moveStep: string;
    screenShareVisible: string;
    screenShareVisibleHint: string;
    autoSend: string;
    autoPreview: string;
    theme: string;
    themes: { gray: string; black: string };
    chatFontSize: string;
  };
  contexts: {
    addFile: string;
    addFolder: string;
    selectedCount: string;
    remove: string;
    folders: string[];
    docs: LibraryDocCopy[];
  };
  presets: {
    add: string;
    activeBadge: string;
    items: PresetCopy[];
  };
  permissions: {
    group: SettingGroupCopy;
    optionalBadge: string;
    granted: string;
    openSettings: string;
    grant: string;
    items: PermissionCopy[];
  };
  updates: {
    group: SettingGroupCopy;
    checking: string;
    latest: string;
    auto: string;
    check: string;
  };
}

export interface HudCopy {
  thinking: string;
  secondsSuffix: string;
  empty: { title: string; recordHint: string; screenshotHint: string };
  jumpToBottom: string;
  modes: { chat: ScreenCopy; notes: ScreenCopy; modePrefix: string };
  tabs: { nav: string; chat: string; closeChat: string; newChat: string; duplicate: string };
  dock: {
    open: string;
    close: string;
    copyLast: string;
    teleprompter: string;
    models: string;
    screenShareVisible: string;
    screenShareHidden: string;
    hotkeys: string;
    mini: string;
    stop: string;
  };
  contextUsage: string;
  message: { copy: string; resend: string; remove: string };
  code: {
    lines: [one: string, few: string, many: string];
    wrapOn: string;
    wrapOff: string;
    copy: string;
    copied: string;
    unknown: string;
  };
  hotkeyGroups: HotkeyGroupCopy[];
  quickActions: QuickActionCopy[];
  quickActionModifier: string;
  composer: {
    placeholder: string;
    clearHistory: string;
    chatContext: string;
    screenshot: string;
    requestParams: string;
    stopAnswer: string;
    send: string;
    sendShortcut: string;
    model: string;
    thinking: string;
    webSearch: string;
    preset: string;
    noPreset: string;
    presets: string[];
    missingKey: string;
  };
  models: {
    title: string;
    searchPlaceholder: string;
    empty: string;
    voiceHeading: string;
    answerHeading: string;
    voice: VoiceModelCopy[];
    groups: ModelGroupCopy[];
  };
  context: {
    title: string;
    fromLibrary: string;
    selectedCount: string;
    ownText: string;
    ownTextHint: string;
    ownTextPlaceholder: string;
    cancel: string;
    save: string;
  };
  teleprompter: {
    empty: string;
    pause: string;
    play: string;
    restart: string;
    speed: string;
    font: string;
    close: string;
  };
  mini: {
    recording: string;
    transcribing: string;
    streaming: string;
    unread: string;
    expand: string;
  };
  notes: {
    searchPlaceholder: string;
    importTitle: string;
    nothingFound: string;
    nothingFoundHint: string;
    addToContext: string;
    removeFromContext: string;
    back: string;
    copy: string;
    matches: string;
    noFolder: string;
  };
}

export interface DemoCopy {
  frameLabel: string;
  ask: string;
  caption: string;
  disclosure: string | null;
  newChatTitle: string;
  chats: DemoChatSeed[];
  prompts: VoicePrompt[];
  fallbackAnswer: string;
  version: string;
  launcher: LauncherCopy;
  hud: HudCopy;
}
