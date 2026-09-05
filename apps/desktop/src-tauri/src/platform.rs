use tauri::{AppHandle, Manager};

use crate::app_state::App;
use crate::events;
use crate::hotkeys;
use crate::window::main_window;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "macos")]
use macos as backend;
#[cfg(target_os = "windows")]
use windows as backend;

pub const WINDOW_CORNER_RADIUS_LOGICAL_PX: f64 = 22.0;

const HTTPS_URL_PREFIX: &str = "https://";
const HTTP_URL_PREFIX: &str = "http://";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModifierMask(u8);

const fn modifier_bit(index: usize) -> ModifierMask {
    ModifierMask(1 << index)
}

impl ModifierMask {
    pub const EMPTY: Self = Self(0);
    pub const CMD: Self = modifier_bit(0);
    pub const CTRL: Self = modifier_bit(1);
    pub const ALT: Self = modifier_bit(2);
    pub const SHIFT: Self = modifier_bit(3);

    pub fn is_empty(self) -> bool {
        self.0 == 0
    }
}

impl std::fmt::Display for ModifierMask {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let names: Vec<&str> = hotkeys::MODIFIER_TOKENS
            .iter()
            .enumerate()
            .filter(|(index, _)| self.0 & modifier_bit(*index).0 != 0)
            .map(|(_, token)| *token)
            .collect();
        if names.is_empty() {
            return f.write_str("нет");
        }
        f.write_str(&names.join(&hotkeys::COMBO_SEPARATOR.to_string()))
    }
}

impl std::ops::BitOr for ModifierMask {
    type Output = Self;

    fn bitor(self, rhs: Self) -> Self {
        Self(self.0 | rhs.0)
    }
}

impl std::ops::BitOrAssign for ModifierMask {
    fn bitor_assign(&mut self, rhs: Self) {
        self.0 |= rhs.0;
    }
}

/// Разбор спеки модификаторов — через ту же таблицу алиасов, что и реестр
/// хоткеев: `Control`/`Option`/`Command` значат то же, что `Ctrl`/`Alt`/`Cmd`.
pub fn modifier_mask(spec: &str) -> ModifierMask {
    let mut mask = ModifierMask::EMPTY;
    for part in spec.split(hotkeys::COMBO_SEPARATOR) {
        if let Some(index) = hotkeys::modifier_index(part) {
            mask |= modifier_bit(index);
        }
    }
    mask
}

#[derive(Clone, Copy)]
enum ArrowAction {
    Move(i32),
    Resize,
}

fn arrow_action(app: &AppHandle, active: ModifierMask) -> Option<ArrowAction> {
    if active.is_empty() {
        return None;
    }
    let st = app.state::<App>();
    let s = st.settings.try_lock().ok()?;
    let move_mask = modifier_mask(&hotkeys::effective(&s.hotkeys, hotkeys::ACTION_MOVE_WINDOW));
    let resize_mask = modifier_mask(&hotkeys::effective(
        &s.hotkeys,
        hotkeys::ACTION_RESIZE_WINDOW,
    ));
    if cfg!(debug_assertions) {
        eprintln!("[стрелки] зажато {active}, сдвиг на {move_mask}, размер на {resize_mask}");
    }
    if active == move_mask {
        return Some(ArrowAction::Move(s.move_step as i32));
    }
    if active == resize_mask {
        return Some(ArrowAction::Resize);
    }
    None
}

fn apply_arrow_action(app: &AppHandle, action: ArrowAction, dx: i32, dy: i32) {
    match action {
        ArrowAction::Move(step) => {
            let Some(w) = main_window(app) else {
                return;
            };
            if let Ok(pos) = w.outer_position() {
                let _ = w.set_position(tauri::PhysicalPosition::new(
                    pos.x + dx * step,
                    pos.y + dy * step,
                ));
            }
        }
        ArrowAction::Resize => events::resize_key(app, dx, dy),
    }
}

pub fn handle_arrow_key(app: &AppHandle, active: ModifierMask, dx: i32, dy: i32) -> bool {
    let Some(action) = arrow_action(app, active) else {
        return false;
    };
    if main_window(app).is_none() {
        return false;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || apply_arrow_action(&handle, action, dx, dy));
    });
    true
}

pub fn disable_cursor_autohide_on_typing() {
    backend::disable_cursor_autohide_on_typing();
}

pub fn clip_native_window_corners(app: &AppHandle) {
    backend::clip_native_window_corners(app);
}

pub fn merge_titlebar_into_content(app: &AppHandle) {
    backend::merge_titlebar_into_content(app);
}

pub fn install_move_keys_monitor(app: AppHandle) {
    backend::install_move_keys_monitor(app);
}

pub fn open_audio_capture_privacy_pane() {
    backend::open_audio_capture_privacy_pane();
}

pub fn open_screen_capture_privacy_pane() {
    backend::open_screen_capture_privacy_pane();
}

pub fn screen_capture_access() -> bool {
    backend::screen_capture_access()
}

pub fn request_screen_capture_access() -> bool {
    backend::request_screen_capture_access()
}

fn is_web_url(url: &str) -> bool {
    url.starts_with(HTTPS_URL_PREFIX) || url.starts_with(HTTP_URL_PREFIX)
}

pub fn open_web_url(url: &str) {
    if is_web_url(url) {
        backend::open_url(url);
    }
}

#[cfg(test)]
mod tests;

pub fn open_microphone_privacy_pane() {
    backend::open_microphone_privacy_pane();
}
