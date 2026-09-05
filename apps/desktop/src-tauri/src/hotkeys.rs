use serde::{Deserialize, Serialize};

pub const ACTION_RECORD: &str = "record";
pub const ACTION_CANCEL_RECORDING: &str = "cancel_recording";
pub const ACTION_SEND: &str = "send";
pub const ACTION_CANCEL_STREAM: &str = "cancel_stream";
pub const ACTION_SCREENSHOT: &str = "screenshot";
pub const ACTION_QUICK_ACTION: &str = "quick_action";
pub const ACTION_FOCUS_PROMPT: &str = "focus_prompt";
pub const ACTION_TOGGLE_WINDOW: &str = "toggle_window";
pub const ACTION_MOVE_WINDOW: &str = "move_window";
pub const ACTION_RESIZE_WINDOW: &str = "resize_window";
pub const ACTION_OPACITY: &str = "opacity";
pub const ACTION_SCROLL_CHAT: &str = "scroll_chat";
pub const ACTION_CHAT_FONT_SIZE: &str = "chat_font_size";
pub const ACTION_DUPLICATE_CHAT: &str = "duplicate_chat";
pub const ACTION_MODEL_MENU: &str = "model_menu";
pub const ACTION_TOGGLE_MODE: &str = "toggle_mode";
pub const ACTION_TELEPROMPTER: &str = "teleprompter";
pub const ACTION_TELEPROMPTER_CLOSE: &str = "teleprompter_close";
pub const ACTION_TELEPROMPTER_PAUSE: &str = "teleprompter_pause";

/// Group ids of `HOTKEY_ACTIONS`. Ids, not labels: the frontend translates
/// them (`hotkeys.groups.<id>` in its dictionaries), and a label baked in here
/// would be one language's text riding a contract that must serve every UI
/// language the same way.
pub const GROUP_RECORD: &str = "record";
pub const GROUP_SEND: &str = "send";
pub const GROUP_WINDOW: &str = "window";
pub const GROUP_CHAT: &str = "chat";
pub const GROUP_NOTES: &str = "notes";
pub const GROUP_TELEPROMPTER: &str = "teleprompter";

macro_rules! cmd_token {
    () => {
        "Cmd"
    };
}
macro_rules! ctrl_token {
    () => {
        "Ctrl"
    };
}
macro_rules! alt_token {
    () => {
        "Alt"
    };
}
macro_rules! shift_token {
    () => {
        "Shift"
    };
}
macro_rules! separator_token {
    () => {
        "+"
    };
}

macro_rules! primary_combo {
    ($($rest:expr),*) => {
        PlatformCombo {
            macos: concat!(cmd_token!() $(, separator_token!(), $rest)*),
            windows: concat!(ctrl_token!() $(, separator_token!(), $rest)*),
        }
    };
}

pub const MODIFIER_CMD: &str = cmd_token!();
pub const MODIFIER_CTRL: &str = ctrl_token!();
pub const MODIFIER_ALT: &str = alt_token!();
pub const MODIFIER_SHIFT: &str = shift_token!();

#[derive(Debug, Clone, Copy, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PlatformCombo {
    pub macos: &'static str,
    pub windows: &'static str,
}

impl PlatformCombo {
    const fn shared(combo: &'static str) -> Self {
        Self { macos: combo, windows: combo }
    }

    pub fn current(&self) -> &'static str {
        if cfg!(target_os = "macos") { self.macos } else { self.windows }
    }
}

#[derive(Debug, Clone, Copy, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PlatformModifierCombos {
    pub macos: &'static [&'static str],
    pub windows: &'static [&'static str],
}

impl PlatformModifierCombos {
    pub fn current(&self) -> &'static [&'static str] {
        if cfg!(target_os = "macos") { self.macos } else { self.windows }
    }
}

pub const MODIFIER_TOKENS: &[&str] =
    &[MODIFIER_CMD, MODIFIER_CTRL, MODIFIER_ALT, MODIFIER_SHIFT];

/// Все написания модификаторов, которые понимает плагин шорткатов и фронт
/// (`MODIFIER_ALIASES` в `lib/hotkeys.ts`), с их каноническим токеном.
/// Единственная таблица: `split_combo` и `platform::modifier_mask` раньше
/// знали только четыре канонических имени, и `Control+S` из старого или
/// ручного JSON плагин регистрировал как Ctrl+S, а разбор конфликтов считал
/// голой `S`, монитор стрелок же не совпадал с ним никогда.
pub const MODIFIER_ALIASES: &[(&str, &str)] = &[
    ("cmd", MODIFIER_CMD),
    ("command", MODIFIER_CMD),
    ("super", MODIFIER_CMD),
    ("meta", MODIFIER_CMD),
    ("ctrl", MODIFIER_CTRL),
    ("control", MODIFIER_CTRL),
    ("alt", MODIFIER_ALT),
    ("option", MODIFIER_ALT),
    ("shift", MODIFIER_SHIFT),
];

/// Канонический токен модификатора для любого его написания, регистр не важен.
pub fn canonical_modifier(token: &str) -> Option<&'static str> {
    let token = token.trim();
    MODIFIER_ALIASES
        .iter()
        .find(|(alias, _)| alias.eq_ignore_ascii_case(token))
        .map(|(_, canonical)| *canonical)
}

/// Позиция канонического модификатора в `MODIFIER_TOKENS` — она же бит
/// `platform::ModifierMask`.
pub fn modifier_index(token: &str) -> Option<usize> {
    let canonical = canonical_modifier(token)?;
    MODIFIER_TOKENS.iter().position(|m| *m == canonical)
}

pub const MODIFIER_COMBOS: PlatformModifierCombos = PlatformModifierCombos {
    macos: &[
        cmd_token!(),
        ctrl_token!(),
        alt_token!(),
        concat!(cmd_token!(), separator_token!(), shift_token!()),
        concat!(ctrl_token!(), separator_token!(), shift_token!()),
        concat!(alt_token!(), separator_token!(), shift_token!()),
    ],
    windows: &[
        ctrl_token!(),
        alt_token!(),
        concat!(ctrl_token!(), separator_token!(), shift_token!()),
        concat!(alt_token!(), separator_token!(), shift_token!()),
    ],
};
const ARROW_KEYS: &[&str] = &["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
const PLUS_MINUS_KEYS: &[&str] = &["Minus", "Equal"];
const BRACKET_KEYS: &[&str] = &["BracketLeft", "BracketRight"];
const FIRST_DIGIT_KEY: usize = 1;
pub const COMBO_SEPARATOR: char = separator_token!().as_bytes()[0] as char;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum HotkeyKind {
    Combo,
    ModifierArrows,
    ModifierPlusMinus,
    ModifierDigits,
    ModifierBrackets,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum HotkeyScope {
    Global,
    Recording,
    Hud,
    Teleprompter,
    Streaming,
}

#[derive(Debug, Clone, Copy, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyAction {
    pub id: &'static str,
    pub group: &'static str,
    pub label: &'static str,
    pub hint: &'static str,
    pub kind: HotkeyKind,
    pub scope: HotkeyScope,
    pub default_combo: PlatformCombo,
}

pub const HOTKEY_ACTIONS: &[HotkeyAction] = &[
    HotkeyAction {
        id: ACTION_RECORD,
        group: GROUP_RECORD,
        label: "Записать системный звук",
        hint: "Удерживайте, пока говорит собеседник.",
        kind: HotkeyKind::Combo,
        scope: HotkeyScope::Global,
        default_combo: primary_combo!("R"),
    },
    HotkeyAction {
        id: ACTION_CANCEL_RECORDING,
        group: GROUP_RECORD,
        label: "Отменить запись",
        hint: "Слушается только пока идёт запись.",
        kind: HotkeyKind::Combo,
        scope: HotkeyScope::Recording,
        default_combo: PlatformCombo::shared("Escape"),
    },
    HotkeyAction {
        id: ACTION_SEND,
        group: GROUP_SEND,
        label: "Отправить",
        hint: "Работает из любого места окна, не только из поля ввода.",
        kind: HotkeyKind::Combo,
        scope: HotkeyScope::Hud,
        default_combo: primary_combo!("Enter"),
    },
    HotkeyAction {
        id: ACTION_CANCEL_STREAM,
        group: GROUP_SEND,
        label: "Остановить ответ",
        hint: "Слушается, только пока пишется ответ.",
        kind: HotkeyKind::Combo,
        scope: HotkeyScope::Streaming,
        default_combo: PlatformCombo::shared("Escape"),
    },
    HotkeyAction {
        id: ACTION_SCREENSHOT,
        group: GROUP_SEND,
        label: "Снимок области экрана",
        hint: "Выделенная область уходит вложением в чат.",
        kind: HotkeyKind::Combo,
        scope: HotkeyScope::Global,
        default_combo: primary_combo!(shift_token!(), "S"),
    },
    HotkeyAction {
        id: ACTION_QUICK_ACTION,
        group: GROUP_SEND,
        label: "Быстрое действие",
        hint: "Модификатор с цифрой: 1…9 по порядку кнопок.",
        kind: HotkeyKind::ModifierDigits,
        scope: HotkeyScope::Hud,
        default_combo: primary_combo!(),
    },
    HotkeyAction {
        id: ACTION_FOCUS_PROMPT,
        group: GROUP_SEND,
        label: "Сфокусировать поле ввода",
        hint: "Поднимает окно и ставит каретку в конец текста.",
        kind: HotkeyKind::Combo,
        scope: HotkeyScope::Global,
        default_combo: primary_combo!(shift_token!(), "D"),
    },
    HotkeyAction {
        id: ACTION_TOGGLE_WINDOW,
        group: GROUP_WINDOW,
        label: "Свернуть или развернуть",
        hint: "Сжимает окно в компактный статус и обратно, работает из любого приложения.",
        kind: HotkeyKind::Combo,
        scope: HotkeyScope::Global,
        default_combo: primary_combo!(shift_token!(), "H"),
    },
    HotkeyAction {
        id: ACTION_MOVE_WINDOW,
        group: GROUP_WINDOW,
        label: "Передвинуть",
        hint: "Модификатор со стрелками.",
        kind: HotkeyKind::ModifierArrows,
        scope: HotkeyScope::Hud,
        default_combo: primary_combo!(),
    },
    HotkeyAction {
        id: ACTION_RESIZE_WINDOW,
        group: GROUP_WINDOW,
        label: "Изменить размер",
        hint: "Модификатор со стрелками.",
        kind: HotkeyKind::ModifierArrows,
        scope: HotkeyScope::Hud,
        default_combo: primary_combo!(shift_token!()),
    },
    HotkeyAction {
        id: ACTION_OPACITY,
        group: GROUP_WINDOW,
        label: "Прозрачность",
        hint: "Модификатор с плюсом и минусом.",
        kind: HotkeyKind::ModifierPlusMinus,
        scope: HotkeyScope::Hud,
        default_combo: primary_combo!(shift_token!()),
    },
    HotkeyAction {
        id: ACTION_CHAT_FONT_SIZE,
        group: GROUP_CHAT,
        label: "Размер шрифта",
        hint: "Модификатор с квадратными скобками.",
        kind: HotkeyKind::ModifierBrackets,
        scope: HotkeyScope::Hud,
        default_combo: primary_combo!(),
    },
    HotkeyAction {
        id: ACTION_SCROLL_CHAT,
        group: GROUP_CHAT,
        label: "Скролл переписки",
        hint: "Модификатор со стрелками вверх и вниз.",
        kind: HotkeyKind::ModifierArrows,
        scope: HotkeyScope::Hud,
        default_combo: PlatformCombo::shared(MODIFIER_ALT),
    },
    HotkeyAction {
        id: ACTION_DUPLICATE_CHAT,
        group: GROUP_CHAT,
        label: "Дубликат чата",
        hint: "Новый чат с параметрами текущего, работает из любого приложения.",
        kind: HotkeyKind::Combo,
        scope: HotkeyScope::Global,
        default_combo: primary_combo!(shift_token!(), "N"),
    },
    HotkeyAction {
        id: ACTION_MODEL_MENU,
        group: GROUP_CHAT,
        label: "Меню моделей",
        hint: "Выбор голосовой модели и модели ответа.",
        kind: HotkeyKind::Combo,
        scope: HotkeyScope::Hud,
        default_combo: primary_combo!(shift_token!(), "M"),
    },
    HotkeyAction {
        id: ACTION_TELEPROMPTER,
        group: GROUP_CHAT,
        label: "Суфлёр",
        hint: "Крупный текст ответа поверх экрана.",
        kind: HotkeyKind::Combo,
        scope: HotkeyScope::Global,
        default_combo: primary_combo!("T"),
    },
    HotkeyAction {
        id: ACTION_TOGGLE_MODE,
        group: GROUP_NOTES,
        label: "Режим заметок",
        hint: "Переключает окно между чатом и заметками.",
        kind: HotkeyKind::Combo,
        scope: HotkeyScope::Hud,
        default_combo: primary_combo!(shift_token!(), "L"),
    },
    HotkeyAction {
        id: ACTION_TELEPROMPTER_CLOSE,
        group: GROUP_TELEPROMPTER,
        label: "Закрыть суфлёр",
        hint: "Слушается только пока суфлёр открыт.",
        kind: HotkeyKind::Combo,
        scope: HotkeyScope::Teleprompter,
        default_combo: PlatformCombo::shared("Escape"),
    },
    HotkeyAction {
        id: ACTION_TELEPROMPTER_PAUSE,
        group: GROUP_TELEPROMPTER,
        label: "Пауза суфлёра",
        hint: "Останавливает автопрокрутку.",
        kind: HotkeyKind::Combo,
        scope: HotkeyScope::Teleprompter,
        default_combo: PlatformCombo::shared("Space"),
    },
];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct HotkeyBinding {
    pub action: String,
    pub combo: String,
}

pub fn action(id: &str) -> Option<&'static HotkeyAction> {
    HOTKEY_ACTIONS.iter().find(|a| a.id == id)
}

pub fn effective(bindings: &[HotkeyBinding], id: &str) -> String {
    if let Some(binding) = bindings.iter().rev().find(|b| b.action == id) {
        return binding.combo.clone();
    }
    action(id).map(|a| a.default_combo.current().to_string()).unwrap_or_default()
}

fn split_combo(combo: &str) -> (Vec<String>, Option<String>) {
    let mut modifiers = Vec::new();
    let mut key = None;
    for raw in combo.split(COMBO_SEPARATOR) {
        let token = raw.trim();
        if token.is_empty() {
            continue;
        }
        match canonical_modifier(token) {
            Some(canonical) => {
                if !modifiers.iter().any(|m: &String| m == canonical) {
                    modifiers.push(canonical.to_string());
                }
            }
            None => key = Some(token.to_string()),
        }
    }
    modifiers.sort();
    (modifiers, key)
}

fn canonical_key(token: &str) -> String {
    let upper = token.trim().to_ascii_uppercase();
    for prefix in ["KEY", "DIGIT"] {
        if let Some(rest) = upper.strip_prefix(prefix) {
            if rest.chars().count() == 1 {
                return rest.to_string();
            }
        }
    }
    upper
}

fn keys_equal(a: &Option<String>, b: &Option<String>) -> bool {
    match (a, b) {
        (Some(a), Some(b)) => canonical_key(a) == canonical_key(b),
        (None, None) => true,
        _ => false,
    }
}

fn is_arrow(key: &str) -> bool {
    ARROW_KEYS.iter().any(|k| k.eq_ignore_ascii_case(key))
}

fn is_plus_minus(key: &str) -> bool {
    PLUS_MINUS_KEYS.iter().any(|k| k.eq_ignore_ascii_case(key))
}

fn is_bracket(key: &str) -> bool {
    BRACKET_KEYS.iter().any(|k| k.eq_ignore_ascii_case(key))
}

/// Какие клавиши занимает вид хоткея. `None` у полного сочетания: оно занимает
/// ровно одну клавишу, а не семейство. Матч исчерпывающий намеренно — новый
/// вид обязан объявить своё семейство здесь, иначе крейт не соберётся.
fn family_keys(kind: HotkeyKind) -> Option<fn(&str) -> bool> {
    match kind {
        HotkeyKind::Combo => None,
        HotkeyKind::ModifierArrows => Some(is_arrow),
        HotkeyKind::ModifierPlusMinus => Some(is_plus_minus),
        HotkeyKind::ModifierDigits => Some(is_digit),
        HotkeyKind::ModifierBrackets => Some(is_bracket),
    }
}

fn is_digit(key: &str) -> bool {
    canonical_key(key)
        .parse::<usize>()
        .is_ok_and(|digit| (FIRST_DIGIT_KEY..=crate::settings::QUICK_ACTION_LIMIT).contains(&digit))
}

fn transient_scope(scope: HotkeyScope) -> bool {
    matches!(
        scope,
        HotkeyScope::Recording | HotkeyScope::Teleprompter | HotkeyScope::Streaming
    )
}

fn scopes_coexist(a: HotkeyScope, b: HotkeyScope) -> bool {
    !(transient_scope(a) && transient_scope(b) && a != b)
}

fn key_spaces_overlap(a: &HotkeyAction, combo_a: &str, b: &HotkeyAction, combo_b: &str) -> bool {
    if combo_a.trim().is_empty() || combo_b.trim().is_empty() {
        return false;
    }
    let (mods_a, key_a) = split_combo(combo_a);
    let (mods_b, key_b) = split_combo(combo_b);
    match (family_keys(a.kind), family_keys(b.kind)) {
        // Два полных сочетания: совпали модификаторы и клавиша.
        (None, None) => mods_a == mods_b && keys_equal(&key_a, &key_b),
        // Два семейства: одинаковые — по модификатору, разные не пересекаются.
        (Some(_), Some(_)) => a.kind == b.kind && mods_a == mods_b,
        // Сочетание против семейства: модификатор совпал и клавиша попала в семейство.
        (None, Some(family)) => mods_a == mods_b && key_a.as_deref().is_some_and(family),
        (Some(family), None) => mods_a == mods_b && key_b.as_deref().is_some_and(family),
    }
}

pub fn conflict(a_id: &str, combo_a: &str, b_id: &str, combo_b: &str) -> bool {
    if a_id == b_id {
        return false;
    }
    let (Some(a), Some(b)) = (action(a_id), action(b_id)) else {
        return false;
    };
    scopes_coexist(a.scope, b.scope) && key_spaces_overlap(a, combo_a, b, combo_b)
}

pub fn normalize(bindings: &mut Vec<HotkeyBinding>) {
    let mut claimed: Vec<(&'static str, String)> = Vec::new();
    for binding in bindings.iter().rev() {
        let Some(action) = action(&binding.action) else { continue };
        if claimed.iter().any(|(id, _)| *id == action.id) {
            continue;
        }
        claimed.push((action.id, binding.combo.trim().to_string()));
    }
    for action in HOTKEY_ACTIONS {
        if !claimed.iter().any(|(id, _)| *id == action.id) {
            claimed.push((action.id, action.default_combo.current().to_string()));
        }
    }

    let mut accepted: Vec<(&'static str, String)> = Vec::new();
    for (id, combo) in claimed {
        let taken = accepted
            .iter()
            .any(|(kept_id, kept_combo)| conflict(id, &combo, kept_id, kept_combo));
        accepted.push((id, if taken { String::new() } else { combo }));
    }

    *bindings = HOTKEY_ACTIONS
        .iter()
        .filter_map(|action| {
            let combo = accepted
                .iter()
                .find(|(id, _)| *id == action.id)
                .map(|(_, combo)| combo.clone())
                .unwrap_or_else(|| action.default_combo.current().to_string());
            (combo != action.default_combo.current())
                .then(|| HotkeyBinding { action: action.id.to_string(), combo })
        })
        .collect();
}

const LEGACY_FIELDS: &[(&str, &str)] = &[
    ("hotkey", ACTION_RECORD),
    ("toggle_hotkey", ACTION_TOGGLE_WINDOW),
    ("teleprompter_hotkey", ACTION_TELEPROMPTER),
    ("screenshot_hotkey", ACTION_SCREENSHOT),
    ("move_modifier", ACTION_MOVE_WINDOW),
    ("resize_modifier", ACTION_RESIZE_WINDOW),
    ("scroll_modifier", ACTION_SCROLL_CHAT),
];

const HOTKEYS_FIELD: &str = "hotkeys";

pub fn migrate_legacy_fields(raw: &mut serde_json::Value) {
    let Some(object) = raw.as_object_mut() else {
        return;
    };
    let already_migrated = object
        .get(HOTKEYS_FIELD)
        .and_then(|v| v.as_array())
        .is_some_and(|a| !a.is_empty());

    let mut migrated = Vec::new();
    for (legacy, action_id) in LEGACY_FIELDS {
        let Some(value) = object.remove(*legacy) else {
            continue;
        };
        if already_migrated {
            continue;
        }
        let Some(combo) = value.as_str() else { continue };
        let combo = combo.trim();
        if combo.is_empty() || combo == effective(&[], action_id) {
            continue;
        }
        migrated.push(serde_json::json!({ "action": action_id, "combo": combo }));
    }
    if !migrated.is_empty() {
        object.insert(HOTKEYS_FIELD.to_string(), serde_json::Value::Array(migrated));
    }
}

/// Выбрасывает из `hotkeys` всё, что не похоже на биндинг (не объект, без
/// строковых `action` и `combo`), а поле не того типа убирает целиком.
///
/// Одна битая запись иначе валила бы десериализацию ВСЕГО файла настроек, и
/// «починкой» становился бы сброс всех настроек пользователя в дефолты.
/// `normalize` неизвестные действия и так терпит — десериализация должна быть
/// не строже его.
pub fn drop_malformed_bindings(raw: &mut serde_json::Value) {
    let Some(object) = raw.as_object_mut() else {
        return;
    };
    let Some(field) = object.get_mut(HOTKEYS_FIELD) else {
        return;
    };
    let Some(bindings) = field.as_array_mut() else {
        object.remove(HOTKEYS_FIELD);
        return;
    };
    bindings.retain(|binding| {
        binding.get("action").is_some_and(serde_json::Value::is_string)
            && binding.get("combo").is_some_and(serde_json::Value::is_string)
    });
}

#[cfg(test)]
mod tests;
