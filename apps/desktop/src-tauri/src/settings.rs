use serde::{Deserialize, Serialize};
use std::path::Path;

const OWNER_ONLY_FILE_MODE: u32 = 0o600;
const TMP_FILE_EXTENSION: &str = "tmp";

pub const THEME_GRAY: &str = "gray";
pub const THEME_BLACK: &str = "black";

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
    pub const PTT_HOTKEY: &str = "F9";
    pub const TOGGLE_HOTKEY: &str = "Cmd+Shift+H";
    pub const TELEPROMPTER_HOTKEY: &str = "F10";
    pub const STT_LANGUAGE: &str = "ru";
    pub const THEME: &str = super::THEME_GRAY;
    pub const MOVE_MODIFIER: &str = "Cmd";
    pub const RESIZE_MODIFIER: &str = "Cmd+Shift";
    pub const SCROLL_MODIFIER: &str = "Alt";
}

pub mod limits {
    use super::Bounds;

    pub mod window {
        use super::Bounds;
        pub const WIDTH: Bounds<f64> = Bounds { default: 960.0, min: 300.0, max: 1600.0 };
        pub const HEIGHT: Bounds<f64> = Bounds { default: 680.0, min: 520.0, max: 1100.0 };
        pub const OPACITY: Bounds<f64> = Bounds { default: 0.9, min: 0.2, max: 1.0 };
        pub const MOVE_STEP: Bounds<u32> = Bounds { default: 20, min: 1, max: 200 };
        pub const RESIZE_STEP: Bounds<u32> = Bounds { default: 20, min: 1, max: 200 };
    }

    pub mod chat {
        use super::Bounds;
        pub const FONT_SIZE: Bounds<f64> = Bounds { default: 13.5, min: 10.0, max: 20.0 };
        pub const SCROLL_STEP: Bounds<u32> = Bounds { default: 120, min: 10, max: 1000 };
    }

    pub mod teleprompter {
        use super::Bounds;
        pub const SPEED: Bounds<f64> = Bounds { default: 40.0, min: 10.0, max: 150.0 };
        pub const FONT_SIZE: Bounds<f64> = Bounds { default: 28.0, min: 20.0, max: 48.0 };
    }

    pub mod capture {
        use super::Bounds;
        pub const BUFFER_SECONDS: Bounds<u32> = Bounds { default: 4, min: 4, max: 10 };
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct PromptPreset {
    pub id: String,
    pub name: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct PluginSetting {
    pub id: String,
    pub enabled: bool,
    pub hotkey: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(default)]
pub struct Settings {
    pub anthropic_api_key: String,
    pub groq_api_key: String,
    pub access_token: String,
    pub prompt_presets: Vec<PromptPreset>,
    pub hotkey: String,
    pub auto_send: bool,
    pub window_opacity: f64,
    pub move_step: u32,
    pub auto_preview_html: bool,
    pub toggle_hotkey: String,
    pub chat_font_size: f64,
    pub skipped_version: String,
    pub stt_language: String,
    pub stt_translate: bool,
    pub screen_share_visible: bool,
    pub teleprompter_speed: f64,
    pub teleprompter_font_size: f64,
    pub teleprompter_hotkey: String,
    pub teleprompter_resume: bool,
    pub window_width: f64,
    pub window_height: f64,
    pub resize_step: u32,
    pub capture_device_uid: String,
    pub theme: String,
    pub scroll_step: u32,
    pub buffer_enabled: bool,
    pub buffer_seconds: u32,
    pub identity_id: String,
    pub move_modifier: String,
    pub resize_modifier: String,
    pub scroll_modifier: String,
    pub plugin_settings: Vec<PluginSetting>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            anthropic_api_key: String::new(),
            groq_api_key: String::new(),
            access_token: String::new(),
            prompt_presets: Vec::new(),
            hotkey: defaults::PTT_HOTKEY.into(),
            auto_send: false,
            window_opacity: limits::window::OPACITY.default,
            move_step: limits::window::MOVE_STEP.default,
            auto_preview_html: true,
            toggle_hotkey: defaults::TOGGLE_HOTKEY.into(),
            chat_font_size: limits::chat::FONT_SIZE.default,
            skipped_version: String::new(),
            stt_language: defaults::STT_LANGUAGE.into(),
            stt_translate: false,
            screen_share_visible: false,
            teleprompter_speed: limits::teleprompter::SPEED.default,
            teleprompter_font_size: limits::teleprompter::FONT_SIZE.default,
            teleprompter_hotkey: defaults::TELEPROMPTER_HOTKEY.into(),
            teleprompter_resume: true,
            window_width: limits::window::WIDTH.default,
            window_height: limits::window::HEIGHT.default,
            resize_step: limits::window::RESIZE_STEP.default,
            capture_device_uid: String::new(),
            theme: defaults::THEME.into(),
            scroll_step: limits::chat::SCROLL_STEP.default,
            buffer_enabled: true,
            buffer_seconds: limits::capture::BUFFER_SECONDS.default,
            identity_id: String::new(),
            move_modifier: defaults::MOVE_MODIFIER.into(),
            resize_modifier: defaults::RESIZE_MODIFIER.into(),
            scroll_modifier: defaults::SCROLL_MODIFIER.into(),
            plugin_settings: Vec::new(),
        }
    }
}

pub const MODIFIER_COMBOS: [&str; 6] =
    ["Cmd", "Ctrl", "Alt", "Cmd+Shift", "Ctrl+Shift", "Alt+Shift"];

fn normalize_modifier(value: &mut String, fallback: &str) {
    if !MODIFIER_COMBOS.contains(&value.trim()) {
        *value = fallback.to_string();
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
        if !crate::identity::is_known_id(&self.identity_id) {
            self.identity_id = String::new();
        }
        normalize_modifier(&mut self.move_modifier, defaults::MOVE_MODIFIER);
        normalize_modifier(&mut self.resize_modifier, defaults::RESIZE_MODIFIER);
        normalize_modifier(&mut self.scroll_modifier, defaults::SCROLL_MODIFIER);
    }

    pub fn load(path: &Path) -> std::io::Result<Self> {
        let mut settings = match std::fs::read_to_string(path) {
            Ok(raw) => serde_json::from_str::<Settings>(&raw)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Settings::default(),
            Err(e) => return Err(e),
        };
        settings.clamp();
        Ok(settings)
    }

    pub fn apply_key_fallback(&mut self, anthropic: Option<String>, groq: Option<String>) {
        if !self.access_token.is_empty() {
            return;
        }
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
        fill_if_empty(&mut self.anthropic_api_key, anthropic);
        fill_if_empty(&mut self.groq_api_key, groq);
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        write_atomic_owner_only(path, &json)
    }
}

pub(crate) fn write_atomic_owner_only(path: &Path, contents: &str) -> std::io::Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension(TMP_FILE_EXTENSION);
    {
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(OWNER_ONLY_FILE_MODE)
            .open(&tmp)?;
        f.write_all(contents.as_bytes())?;
    }
    std::fs::rename(&tmp, path)
}

#[cfg(test)]
mod tests;
