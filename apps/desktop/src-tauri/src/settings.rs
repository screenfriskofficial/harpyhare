use serde::{Deserialize, Serialize};
use std::fmt;
use std::path::{Path, PathBuf};

#[cfg(unix)]
const OWNER_ONLY_FILE_MODE: u32 = 0o600;

/// Суффикс, под которым нечитаемый файл настроек откладывается рядом с собой:
/// `settings.json.broken-<unix-время>`. Файл не удаляется никогда — в нём могут
/// быть ключи и пресеты пользователя, которые он восстановит руками.
pub const QUARANTINE_SUFFIX: &str = "broken";

pub const THEME_GRAY: &str = "gray";
pub const THEME_BLACK: &str = "black";

/// UI languages the frontend ships dictionaries for. The list lives here, not
/// in TypeScript, so `clamp` and the launcher's select agree on the vocabulary:
/// the constant is exported through `bindings.ts`, and the frontend's
/// `Record<UiLanguage, Dictionary>` fails to compile when a language listed
/// here has no dictionary. The empty string means "follow the system locale";
/// the resolution itself happens in the frontend, which is the only side that
/// renders text — Rust never needs to know which language won.
pub const UI_LANGUAGE_SYSTEM: &str = "";
pub const UI_LANGUAGES: &[&str] = &["ru", "en"];

/// Ids of the API-key fields below, as the LLM registry and the frontend name
/// them. `api_key_for` is the only place the two vocabularies meet.
pub const API_KEY_ANTHROPIC: &str = "anthropic";
pub const API_KEY_GROQ: &str = "groq";
pub const API_KEY_OPENAI: &str = "openai";
pub const API_KEY_XAI: &str = "xai";
pub const API_KEY_DEEPGRAM: &str = "deepgram";
pub const API_KEY_OPENROUTER: &str = "openrouter";
pub const API_KEY_XCLIS: &str = "xclis";

/// The key a registry row asks for, or `""` when it names one that does not
/// exist — which the pickers render as a permanent lock rather than a crash.
pub fn api_key_for<'a>(s: &'a Settings, key_id: &str) -> &'a str {
    match key_id {
        API_KEY_ANTHROPIC => &s.anthropic_api_key,
        API_KEY_GROQ => &s.groq_api_key,
        API_KEY_OPENAI => &s.openai_api_key,
        API_KEY_XAI => &s.xai_api_key,
        API_KEY_DEEPGRAM => &s.deepgram_api_key,
        API_KEY_OPENROUTER => &s.openrouter_api_key,
        API_KEY_XCLIS => &s.xclis_api_key,
        _ => "",
    }
}

/// Изменяемая половина `api_key_for` — единственный второй список полей-ключей.
/// Новое поле добавляется в оба `match`, и тест
/// `every_registry_key_id_resolves_to_a_real_settings_field` ловит забытую ветку.
fn api_key_mut<'a>(s: &'a mut Settings, key_id: &str) -> Option<&'a mut String> {
    match key_id {
        API_KEY_ANTHROPIC => Some(&mut s.anthropic_api_key),
        API_KEY_GROQ => Some(&mut s.groq_api_key),
        API_KEY_OPENAI => Some(&mut s.openai_api_key),
        API_KEY_XAI => Some(&mut s.xai_api_key),
        API_KEY_DEEPGRAM => Some(&mut s.deepgram_api_key),
        API_KEY_OPENROUTER => Some(&mut s.openrouter_api_key),
        API_KEY_XCLIS => Some(&mut s.xclis_api_key),
        _ => None,
    }
}

/// Все `key_id`, которые просят реестры вендоров (ответы и речь), без дублей,
/// и признак «relay проксирует КАЖДОГО вендора с этим ключом». Только такой
/// ключ код доступа глушит целиком; если хоть один вендор с этим ключом идёт
/// мимо relay, личный ключ ему нужен и под кодом.
pub fn registry_key_ids() -> Vec<(&'static str, bool)> {
    let llm_rows = crate::llm::registry::PROVIDERS
        .iter()
        .map(|p| (p.key_id, p.proxied));
    let stt_rows = crate::stt::registry::PROVIDERS
        .iter()
        .map(|p| (p.key_id, p.proxied));
    let mut ids: Vec<(&'static str, bool)> = Vec::new();
    for (key_id, proxied) in llm_rows.chain(stt_rows) {
        match ids.iter_mut().find(|(id, _)| *id == key_id) {
            Some((_, proxied_everywhere)) => *proxied_everywhere &= proxied,
            None => ids.push((key_id, proxied)),
        }
    }
    ids
}

/// Re-exported from the STT registry, which owns the list. Kept as names so
/// call sites read as intent rather than as string literals.
pub use crate::stt::registry::{
    PROVIDER_GROQ as STT_PROVIDER_GROQ, PROVIDER_OPENAI as STT_PROVIDER_OPENAI,
};

pub const QUICK_ACTION_LIMIT: usize = 9;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, specta::Type)]
pub struct Bounds<T> {
    pub default: T,
    pub min: T,
    pub max: T,
}

impl Bounds<f64> {
    pub fn clamp(&self, value: f64) -> f64 {
        if value.is_finite() {
            value.clamp(self.min, self.max)
        } else {
            self.default
        }
    }
}

impl Bounds<u32> {
    pub fn clamp(&self, value: u32) -> u32 {
        value.clamp(self.min, self.max)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SettingsLimits {
    pub window_width: Bounds<f64>,
    pub window_height: Bounds<f64>,
    pub window_opacity: Bounds<f64>,
    pub move_step: Bounds<u32>,
    pub resize_step: Bounds<u32>,
    pub chat_font_size: Bounds<f64>,
    pub scroll_step: Bounds<u32>,
    pub teleprompter_speed: Bounds<f64>,
    pub teleprompter_font_size: Bounds<f64>,
    pub buffer_seconds: Bounds<u32>,
}

impl SettingsLimits {
    pub fn current() -> Self {
        Self {
            window_width: limits::window::WIDTH,
            window_height: limits::window::HEIGHT,
            window_opacity: limits::window::OPACITY,
            move_step: limits::window::MOVE_STEP,
            resize_step: limits::window::RESIZE_STEP,
            chat_font_size: limits::chat::FONT_SIZE,
            scroll_step: limits::chat::SCROLL_STEP,
            teleprompter_speed: limits::teleprompter::SPEED,
            teleprompter_font_size: limits::teleprompter::FONT_SIZE,
            buffer_seconds: limits::capture::BUFFER_SECONDS,
        }
    }
}

pub mod defaults {
    pub const STT_LANGUAGE: &str = "ru";

    pub const THEME: &str = super::THEME_GRAY;

    pub const UI_LANGUAGE: &str = super::UI_LANGUAGE_SYSTEM;
}

pub mod limits {
    use super::Bounds;

    pub mod window {
        use super::Bounds;
        pub const WIDTH: Bounds<f64> = Bounds {
            default: 960.0,
            min: 300.0,
            max: 1600.0,
        };
        pub const HEIGHT: Bounds<f64> = Bounds {
            default: 680.0,
            min: 520.0,
            max: 1100.0,
        };
        pub const OPACITY: Bounds<f64> = Bounds {
            default: 0.9,
            min: 0.2,
            max: 1.0,
        };
        pub const MOVE_STEP: Bounds<u32> = Bounds {
            default: 20,
            min: 1,
            max: 200,
        };
        pub const RESIZE_STEP: Bounds<u32> = Bounds {
            default: 20,
            min: 1,
            max: 200,
        };
    }

    pub mod chat {
        use super::Bounds;
        pub const FONT_SIZE: Bounds<f64> = Bounds {
            default: 13.5,
            min: 10.0,
            max: 20.0,
        };
        pub const SCROLL_STEP: Bounds<u32> = Bounds {
            default: 120,
            min: 10,
            max: 1000,
        };
    }

    pub mod teleprompter {
        use super::Bounds;
        pub const SPEED: Bounds<f64> = Bounds {
            default: 40.0,
            min: 10.0,
            max: 150.0,
        };
        pub const FONT_SIZE: Bounds<f64> = Bounds {
            default: 28.0,
            min: 20.0,
            max: 48.0,
        };
    }

    pub mod capture {
        use super::Bounds;
        pub const BUFFER_SECONDS: Bounds<u32> = Bounds {
            default: 4,
            min: 1,
            max: 10,
        };
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct PromptPreset {
    pub id: String,
    pub name: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct QuickAction {
    pub id: String,
    pub title: String,
    pub prompt: String,
}

struct QuickActionSeed {
    id: &'static str,
    title: &'static str,
    prompt: &'static str,
}

const QUICK_ACTION_SEEDS: &[QuickActionSeed] = &[
    QuickActionSeed {
        id: "detail",
        title: "Подробнее",
        prompt: "Расскажи более подробно.",
    },
    QuickActionSeed {
        id: "brief",
        title: "Короче",
        prompt: "Ответь короче, только суть.",
    },
    QuickActionSeed {
        id: "code",
        title: "Пример кода",
        prompt: "Покажи пример кода.",
    },
];

fn seeded_quick_actions() -> Vec<QuickAction> {
    QUICK_ACTION_SEEDS
        .iter()
        .map(|seed| QuickAction {
            id: seed.id.into(),
            title: seed.title.into(),
            prompt: seed.prompt.into(),
        })
        .collect()
}

#[derive(Clone, Serialize, Deserialize, specta::Type)]
#[serde(default)]
pub struct Settings {
    pub anthropic_api_key: String,
    pub groq_api_key: String,
    pub openai_api_key: String,
    pub xai_api_key: String,
    pub deepgram_api_key: String,
    pub openrouter_api_key: String,
    pub xclis_api_key: String,
    pub access_token: String,
    pub prompt_presets: Vec<PromptPreset>,
    pub hotkeys: Vec<crate::hotkeys::HotkeyBinding>,
    pub auto_send: bool,
    pub window_opacity: f64,
    pub move_step: u32,
    pub auto_preview_html: bool,
    pub chat_font_size: f64,
    pub skipped_version: String,
    pub stt_language: String,
    pub stt_translate: bool,
    pub stt_provider: String,
    pub openrouter_stt_model: String,
    pub screen_share_visible: bool,
    pub teleprompter_speed: f64,
    pub teleprompter_font_size: f64,
    pub teleprompter_resume: bool,
    pub audio_permission_requested: bool,
    pub screen_permission_requested: bool,
    pub window_width: f64,
    pub window_height: f64,
    pub resize_step: u32,
    pub capture_device_uid: String,
    pub microphone_device_uid: String,
    pub capture_system_audio: bool,
    pub capture_microphone: bool,
    pub theme: String,
    pub ui_language: String,
    pub scroll_step: u32,
    pub buffer_enabled: bool,
    pub buffer_seconds: u32,
    pub quick_actions: Vec<QuickAction>,
    pub quick_action_attachments: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            anthropic_api_key: String::new(),
            groq_api_key: String::new(),
            openai_api_key: String::new(),
            xai_api_key: String::new(),
            deepgram_api_key: String::new(),
            openrouter_api_key: String::new(),
            xclis_api_key: String::new(),
            access_token: String::new(),
            prompt_presets: Vec::new(),
            hotkeys: Vec::new(),
            auto_send: false,
            window_opacity: limits::window::OPACITY.default,
            move_step: limits::window::MOVE_STEP.default,
            auto_preview_html: true,
            chat_font_size: limits::chat::FONT_SIZE.default,
            skipped_version: String::new(),
            stt_language: defaults::STT_LANGUAGE.into(),
            stt_translate: false,
            stt_provider: crate::stt::registry::default_spec().id.into(),
            openrouter_stt_model: crate::stt::registry::DEFAULT_OPENROUTER_MODEL.into(),
            screen_share_visible: false,
            teleprompter_speed: limits::teleprompter::SPEED.default,
            teleprompter_font_size: limits::teleprompter::FONT_SIZE.default,
            teleprompter_resume: true,
            audio_permission_requested: false,
            screen_permission_requested: false,
            window_width: limits::window::WIDTH.default,
            window_height: limits::window::HEIGHT.default,
            resize_step: limits::window::RESIZE_STEP.default,
            capture_device_uid: String::new(),
            microphone_device_uid: String::new(),
            capture_system_audio: true,
            capture_microphone: false,
            theme: defaults::THEME.into(),
            ui_language: defaults::UI_LANGUAGE.into(),
            scroll_step: limits::chat::SCROLL_STEP.default,
            buffer_enabled: true,
            buffer_seconds: limits::capture::BUFFER_SECONDS.default,
            quick_actions: seeded_quick_actions(),
            quick_action_attachments: false,
        }
    }
}

fn is_secret_field(name: &str) -> bool {
    name.ends_with("_api_key") || name == "access_token"
}

fn redacted(field: &serde_json::Value) -> serde_json::Value {
    match field.as_str() {
        Some("") => serde_json::Value::String(String::new()),
        Some(secret) => serde_json::Value::String(format!("<{} симв.>", secret.chars().count())),
        None => serde_json::Value::String("<скрыто>".into()),
    }
}

/// `{:?}` настроек не должен выводить ключи и токен: структура попадает в
/// логи и тексты паник, а новое поле-ключ подпадает под правило по суффиксу
/// `_api_key` само, без правки этого места.
impl fmt::Debug for Settings {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut value = serde_json::to_value(self).map_err(|_| fmt::Error)?;
        if let Some(object) = value.as_object_mut() {
            for (name, field) in object.iter_mut() {
                if is_secret_field(name) {
                    *field = redacted(field);
                }
            }
        }
        write!(f, "Settings {value}")
    }
}

impl Settings {
    pub fn clamp(&mut self) {
        self.window_opacity = limits::window::OPACITY.clamp(self.window_opacity);
        self.window_width = limits::window::WIDTH.clamp(self.window_width);
        self.window_height = limits::window::HEIGHT.clamp(self.window_height);
        self.move_step = limits::window::MOVE_STEP.clamp(self.move_step);
        self.resize_step = limits::window::RESIZE_STEP.clamp(self.resize_step);
        self.chat_font_size = limits::chat::FONT_SIZE.clamp(self.chat_font_size);
        self.scroll_step = limits::chat::SCROLL_STEP.clamp(self.scroll_step);
        self.teleprompter_speed = limits::teleprompter::SPEED.clamp(self.teleprompter_speed);
        self.teleprompter_font_size =
            limits::teleprompter::FONT_SIZE.clamp(self.teleprompter_font_size);
        self.buffer_seconds = limits::capture::BUFFER_SECONDS.clamp(self.buffer_seconds);
        if self.theme != THEME_GRAY && self.theme != THEME_BLACK {
            self.theme = defaults::THEME.into();
        }
        if self.ui_language != UI_LANGUAGE_SYSTEM
            && !UI_LANGUAGES.contains(&self.ui_language.as_str())
        {
            self.ui_language = defaults::UI_LANGUAGE.into();
        }
        // The registry owns "unknown resolves to the default"; clamping here by
        // hand would be a second, silently divergent copy of that rule.
        self.stt_provider = crate::stt::registry::resolve(&self.stt_provider).id.into();
        // The catalog is dynamic: retain saved IDs even while offline or after
        // a catalog change. Only a blank value falls back to the default.
        self.openrouter_stt_model = self.openrouter_stt_model.trim().to_string();
        if self.openrouter_stt_model.is_empty() {
            self.openrouter_stt_model = crate::stt::registry::DEFAULT_OPENROUTER_MODEL.into();
        }
        self.quick_actions.truncate(QUICK_ACTION_LIMIT);
        crate::hotkeys::normalize(&mut self.hotkeys);
    }

    /// Читает файл как есть. Отсутствующий файл — дефолты, нечитаемый —
    /// `InvalidData` (JSON не разбирается или поле не того типа), остальные
    /// ошибки ввода-вывода — как есть. Что делать с нечитаемым файлом, решает
    /// `load_or_quarantine`; этот метод его не трогает.
    pub fn load(path: &Path) -> std::io::Result<Self> {
        let mut settings = match std::fs::read_to_string(path) {
            Ok(raw) => {
                let mut value: serde_json::Value = serde_json::from_str(&raw)
                    .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
                crate::hotkeys::migrate_legacy_fields(&mut value);
                crate::hotkeys::drop_malformed_bindings(&mut value);
                serde_json::from_value::<Settings>(value)
                    .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Settings::default(),
            Err(e) => return Err(e),
        };
        settings.clamp();
        Ok(settings)
    }

    /// Загрузка на старте приложения: нечитаемый файл уходит в карантин
    /// (`settings.json.broken-<время>`), а приложение стартует с дефолтами.
    ///
    /// Раньше любая ошибка чтения молча превращалась в `Settings::default()`,
    /// и первый же автосейв лаунчера записывал дефолты ПОВЕРХ файла с ключами,
    /// пресетами и хоткеями пользователя. Карантин оставляет файл на месте под
    /// другим именем: восстановить его можно руками, а затереть — нельзя.
    pub fn load_or_quarantine(path: &Path) -> Self {
        match Self::load(path) {
            Ok(settings) => settings,
            Err(e) if e.kind() == std::io::ErrorKind::InvalidData => {
                let quarantined = quarantine_path(path);
                match std::fs::rename(path, &quarantined) {
                    Ok(()) => eprintln!(
                        "{} не читается ({e}); файл отложен в {}, старт с дефолтами",
                        path.display(),
                        quarantined.display()
                    ),
                    Err(rename_err) => eprintln!(
                        "{} не читается ({e}) и не откладывается ({rename_err}); старт с дефолтами",
                        path.display()
                    ),
                }
                Settings::default()
            }
            Err(e) => {
                eprintln!("{} не прочитан ({e}); старт с дефолтами", path.display());
                Settings::default()
            }
        }
    }

    /// Заполняет ПУСТЫЕ поля ключей значениями из окружения (`.env`-фолбэк).
    ///
    /// Какие ключи бывают — знают реестры вендоров, а не этот метод: он идёт
    /// по `key_id` каждой строки обоих реестров и спрашивает у `lookup`
    /// значение (соглашение `<KEY_ID>_API_KEY` — то же, что у смоуков в
    /// `examples/`). Правило про код доступа тоже берётся из реестра: у
    /// вендора, которого relay проксирует, код и так глушит личный ключ,
    /// поэтому при непустом `access_token` его ключ из окружения не
    /// подставляется; вендор без роута на relay (`proxied: false`) берёт ключ
    /// всегда — иначе код доступа запирал бы его у того, кто ключ как раз
    /// положил.
    pub fn apply_key_fallback(&mut self, lookup: impl Fn(&str) -> Option<String>) {
        let has_access_token = !self.access_token.is_empty();
        for (key_id, proxied_everywhere) in registry_key_ids() {
            if proxied_everywhere && has_access_token {
                continue;
            }
            let Some(target) = api_key_mut(self, key_id) else {
                continue;
            };
            if !target.is_empty() {
                continue;
            }
            let Some(candidate) = lookup(key_id) else {
                continue;
            };
            let candidate = candidate.trim();
            if !candidate.is_empty() {
                *target = candidate.to_string();
            }
        }
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        write_atomic_owner_only(path, &json)
    }
}

fn quarantine_path(path: &Path) -> PathBuf {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    path.with_file_name(format!("{name}.{QUARANTINE_SUFFIX}-{stamp}"))
}

/// Each writer owns its temporary file. A shared `settings.tmp` lets another
/// save truncate it or keep writing after it has become the destination.
/// `NamedTempFile` also removes an unpublished file on every error path.
pub(crate) fn write_atomic_owner_only(path: &Path, contents: &str) -> std::io::Result<()> {
    use std::io::Write;
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    std::fs::create_dir_all(parent)?;
    let mut tmp = tempfile::NamedTempFile::new_in(parent)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        tmp.as_file()
            .set_permissions(std::fs::Permissions::from_mode(OWNER_ONLY_FILE_MODE))?;
    }
    tmp.write_all(contents.as_bytes())?;
    tmp.as_file().sync_all()?;
    tmp.persist(path).map_err(|e| e.error)?;
    Ok(())
}

#[cfg(test)]
mod tests;
