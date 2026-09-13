use serde::{Deserialize, Serialize};
use std::path::Path;

#[cfg(unix)]
const OWNER_ONLY_FILE_MODE: u32 = 0o600;
pub const QUARANTINE_SUFFIX: &str = "broken";

pub const THEME_GRAY: &str = "gray";
pub const THEME_BLACK: &str = "black";

/// Ids of the API-key fields below, as the LLM registry and the frontend name
/// them. `api_key_for` is the only place the two vocabularies meet.
pub const API_KEY_ANTHROPIC: &str = "anthropic";
pub const API_KEY_GROQ: &str = "groq";
pub const API_KEY_OPENAI: &str = "openai";
pub const API_KEY_XAI: &str = "xai";
pub const API_KEY_DEEPGRAM: &str = "deepgram";
pub const API_KEY_XCLIS: &str = "xclis";
pub const API_KEY_OPENROUTER: &str = "openrouter";

/// The key a registry row asks for, or `""` when it names one that does not
/// exist — which the pickers render as a permanent lock rather than a crash.
pub fn api_key_for<'a>(s: &'a Settings, key_id: &str) -> &'a str {
    match key_id {
        API_KEY_ANTHROPIC => &s.anthropic_api_key,
        API_KEY_GROQ => &s.groq_api_key,
        API_KEY_OPENAI => &s.openai_api_key,
        API_KEY_XAI => &s.xai_api_key,
        API_KEY_DEEPGRAM => &s.deepgram_api_key,
        API_KEY_XCLIS => &s.xclis_api_key,
        API_KEY_OPENROUTER => &s.openrouter_api_key,
        _ => "",
    }
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

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(default)]
pub struct Settings {
    pub anthropic_api_key: String,
    pub groq_api_key: String,
    pub openai_api_key: String,
    pub xai_api_key: String,
    pub deepgram_api_key: String,
    pub xclis_api_key: String,
    pub openrouter_api_key: String,
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
    pub theme: String,
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
            xclis_api_key: String::new(),
            openrouter_api_key: String::new(),
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
            theme: defaults::THEME.into(),
            scroll_step: limits::chat::SCROLL_STEP.default,
            buffer_enabled: true,
            buffer_seconds: limits::capture::BUFFER_SECONDS.default,
            quick_actions: seeded_quick_actions(),
            quick_action_attachments: false,
        }
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
        // The registry owns "unknown resolves to the default"; clamping here by
        // hand would be a second, silently divergent copy of that rule.
        self.stt_provider = crate::stt::registry::resolve(&self.stt_provider).id.into();
        self.quick_actions.truncate(QUICK_ACTION_LIMIT);
        crate::hotkeys::normalize(&mut self.hotkeys);
    }

    pub fn load(path: &Path) -> std::io::Result<Self> {
        let mut settings = match std::fs::read_to_string(path) {
            Ok(raw) => {
                let mut value: serde_json::Value = match serde_json::from_str(&raw) {
                    Ok(value) => value,
                    Err(error) => {
                        quarantine_broken_file(path);
                        return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, error));
                    }
                };
                crate::hotkeys::migrate_legacy_fields(&mut value);
                match serde_json::from_value::<Settings>(value) {
                    Ok(settings) => settings,
                    Err(error) => {
                        quarantine_broken_file(path);
                        return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, error));
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Settings::default(),
            Err(e) => return Err(e),
        };
        settings.clamp();
        Ok(settings)
    }

    pub fn apply_key_fallback(
        &mut self,
        anthropic: Option<String>,
        groq: Option<String>,
        openai: Option<String>,
        xai: Option<String>,
        deepgram: Option<String>,
        xclis: Option<String>,
        openrouter: Option<String>,
    ) {
        fn fill_if_empty(target: &mut String, candidate: Option<String>) {
            if !target.is_empty() {
                return;
            }
            if let Some(v) = candidate {
                let v = v.trim();
                if !v.is_empty() {
                    *target = v.to_string();
                }
            }
        }
        // Вендоры, до которых код доступа не дотягивается (`proxied: false`),
        // берут ключ из окружения ВСЕГДА: relay их не проксирует, поэтому без
        // своего ключа они просто заперты, и подавлять фолбэк наличием кода
        // означало бы запереть их у того, кто ключ как раз положил.
        fill_if_empty(&mut self.xai_api_key, xai);
        fill_if_empty(&mut self.deepgram_api_key, deepgram);
        fill_if_empty(&mut self.xclis_api_key, xclis);
        fill_if_empty(&mut self.openrouter_api_key, openrouter);
        if !self.access_token.is_empty() {
            return;
        }
        fill_if_empty(&mut self.anthropic_api_key, anthropic);
        fill_if_empty(&mut self.groq_api_key, groq);
        fill_if_empty(&mut self.openai_api_key, openai);
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        write_atomic_owner_only(path, &json)
    }
}

fn quarantine_broken_file(path: &Path) {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy())
        .unwrap_or_default();
    let quarantined = path.with_file_name(format!("{name}.{QUARANTINE_SUFFIX}-{stamp}"));
    if let Err(error) = std::fs::rename(path, &quarantined) {
        eprintln!("не удалось сохранить повреждённые настройки: {error}");
    } else {
        eprintln!(
            "повреждённые настройки отложены в {}",
            quarantined.display()
        );
    }
}

pub(crate) fn write_atomic_owner_only(path: &Path, contents: &str) -> std::io::Result<()> {
    use std::io::Write;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let mut tmp = tempfile::NamedTempFile::new_in(parent)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        tmp.as_file()
            .set_permissions(std::fs::Permissions::from_mode(OWNER_ONLY_FILE_MODE))?;
    }
    tmp.write_all(contents.as_bytes())?;
    tmp.as_file().sync_all()?;
    tmp.persist(path).map_err(|error| error.error)?;
    Ok(())
}

#[cfg(test)]
mod tests;
