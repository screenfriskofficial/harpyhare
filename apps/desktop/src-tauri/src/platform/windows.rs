use std::sync::OnceLock;

use tauri::AppHandle;
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE, DWMWA_WINDOW_CORNER_PREFERENCE,
    DWMWCP_ROUND, DWMWINDOWATTRIBUTE,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, VIRTUAL_KEY, VK_CONTROL, VK_DOWN, VK_LEFT, VK_LWIN, VK_MENU, VK_RIGHT,
    VK_RWIN, VK_SHIFT, VK_UP,
};
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, GetAncestor, GetForegroundWindow, SetWindowsHookExW, GA_ROOTOWNER, HC_ACTION,
    KBDLLHOOKSTRUCT, SW_SHOWNORMAL, WH_KEYBOARD_LL, WM_KEYDOWN, WM_SYSKEYDOWN,
};

use super::{handle_arrow_key, ModifierMask};
use crate::window::main_window;

const KEY_PRESSED_MASK: u16 = 0x8000;
const SWALLOW_EVENT: LRESULT = LRESULT(1);
const AUDIO_PRIVACY_PANE_URL: PCWSTR = w!("ms-settings:privacy-microphone");
const SCREEN_PRIVACY_PANE_URL: PCWSTR = w!("ms-settings:privacy");
const SHELL_OPEN_VERB: PCWSTR = w!("open");

static HOOK_APP: OnceLock<AppHandle> = OnceLock::new();

pub fn disable_cursor_autohide_on_typing() {}

pub fn merge_titlebar_into_content(_app: &AppHandle) {}

fn set_dwm_attribute<T>(hwnd: HWND, attribute: DWMWINDOWATTRIBUTE, value: &T) {
    let _ = unsafe {
        DwmSetWindowAttribute(
            hwnd,
            attribute,
            std::ptr::from_ref(value).cast(),
            std::mem::size_of::<T>() as u32,
        )
    };
}

pub fn clip_native_window_corners(app: &AppHandle) {
    let Some(w) = main_window(app) else {
        return;
    };
    let Ok(hwnd) = w.hwnd() else {
        return;
    };
    set_dwm_attribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, &DWMWCP_ROUND);
    set_dwm_attribute(hwnd, DWMWA_BORDER_COLOR, &DWMWA_COLOR_NONE);
}

fn key_pressed(key: VIRTUAL_KEY) -> bool {
    (unsafe { GetAsyncKeyState(key.0 as i32) } as u16 & KEY_PRESSED_MASK) != 0
}

fn pressed_modifiers() -> ModifierMask {
    let mut mask = ModifierMask::EMPTY;
    if key_pressed(VK_LWIN) || key_pressed(VK_RWIN) {
        mask |= ModifierMask::CMD;
    }
    if key_pressed(VK_CONTROL) {
        mask |= ModifierMask::CTRL;
    }
    if key_pressed(VK_MENU) {
        mask |= ModifierMask::ALT;
    }
    if key_pressed(VK_SHIFT) {
        mask |= ModifierMask::SHIFT;
    }
    mask
}

fn arrow_delta(virtual_key: u32) -> Option<(i32, i32)> {
    match VIRTUAL_KEY(virtual_key as u16) {
        VK_LEFT => Some((-1, 0)),
        VK_RIGHT => Some((1, 0)),
        VK_DOWN => Some((0, 1)),
        VK_UP => Some((0, -1)),
        _ => None,
    }
}

fn is_key_down(message: WPARAM) -> bool {
    message.0 as u32 == WM_KEYDOWN || message.0 as u32 == WM_SYSKEYDOWN
}

fn hud_is_focused(app: &AppHandle) -> bool {
    let Some(w) = main_window(app) else {
        return false;
    };
    let Ok(hwnd) = w.hwnd() else {
        return false;
    };
    let foreground = unsafe { GetForegroundWindow() };
    let owner = unsafe { GetAncestor(foreground, GA_ROOTOWNER) };
    foreground == hwnd || owner == hwnd
}

/// Хук низкоуровневый и глобальный, поэтому обязан быть дешёвым: сначала
/// модификаторы (четыре `GetAsyncKeyState`), и только для стрелки с зажатым
/// модификатором — сверка фокуса с HUD (лок карты окон Tauri). Голые стрелки
/// в любом приложении раньше платили за этот лок на каждое нажатие.
unsafe extern "system" fn arrow_keys_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 && is_key_down(wparam) {
        let event = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
        if let (Some((dx, dy)), Some(app)) = (arrow_delta(event.vkCode), HOOK_APP.get()) {
            let modifiers = pressed_modifiers();
            if !modifiers.is_empty() {
                let focused = hud_is_focused(app);
                if cfg!(debug_assertions) && !focused {
                    eprintln!("[стрелки] окно HUD не активно — событие пропущено дальше");
                }
                if focused && handle_arrow_key(app, modifiers, dx, dy) {
                    return SWALLOW_EVENT;
                }
            }
        }
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

pub fn install_move_keys_monitor(app: AppHandle) {
    if HOOK_APP.set(app).is_err() {
        return;
    }
    let module = unsafe { GetModuleHandleW(None) }.map(|handle| HINSTANCE(handle.0));
    let installed =
        unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(arrow_keys_hook), module.ok(), 0) };
    match installed {
        Ok(_) => eprintln!("перехват стрелок установлен"),
        Err(e) => eprintln!("не удалось поставить перехват стрелок: {e}"),
    }
}

fn open_with_shell(target: PCWSTR) {
    unsafe {
        ShellExecuteW(
            None,
            SHELL_OPEN_VERB,
            target,
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
}

pub fn open_audio_capture_privacy_pane() {
    open_with_shell(AUDIO_PRIVACY_PANE_URL);
}

pub fn open_screen_capture_privacy_pane() {
    open_with_shell(SCREEN_PRIVACY_PANE_URL);
}

pub fn screen_capture_access() -> bool {
    true
}

pub fn request_screen_capture_access() -> bool {
    true
}

pub fn open_url(url: &str) {
    let wide: Vec<u16> = url.encode_utf16().chain(std::iter::once(0)).collect();
    open_with_shell(PCWSTR(wide.as_ptr()));
}

pub fn open_microphone_privacy_pane() {
    open_audio_capture_privacy_pane();
}
