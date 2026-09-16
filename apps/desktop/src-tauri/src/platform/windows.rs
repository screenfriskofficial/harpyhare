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
use windows::Win32::UI::Shell::{
    DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass, ShellExecuteW,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, GetAncestor, GetForegroundWindow, GetWindowLongPtrW, SetWindowLongPtrW,
    SetWindowPos, SetWindowsHookExW, GA_ROOTOWNER, GWL_EXSTYLE, HC_ACTION, KBDLLHOOKSTRUCT,
    STYLESTRUCT, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
    SW_SHOWNORMAL, WH_KEYBOARD_LL, WM_KEYDOWN, WM_NCDESTROY, WM_STYLECHANGING, WM_SYSKEYDOWN,
    WS_EX_APPWINDOW, WS_EX_TOOLWINDOW,
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

pub fn reset_screen_capture_access(_identifier: &str) -> Result<(), String> {
    Err("Восстановление разрешения экрана доступно только на macOS".into())
}

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

/// Subclass id for the HUD window: comctl32 tells subclasses apart by the
/// (procedure, id) pair, and the HUD installs exactly one.
const WINDOW_SWITCHER_SUBCLASS_ID: usize = 1;

/// A tool window has no taskbar button and is skipped by Alt+Tab; the app
/// window bit forces both back, so it goes together with the tool bit.
fn switcher_hidden_ex_style(ex_style: u32) -> u32 {
    (ex_style | WS_EX_TOOLWINDOW.0) & !WS_EX_APPWINDOW.0
}

/// Rewrites every incoming `GWL_EXSTYLE` so the HUD stays a tool window.
/// tao recomputes the extended style from its own `WindowFlags` on any
/// `show`/`hide`/`set_resizable` (`WindowState::apply_diff`), so a style set
/// once would be undone by the first collapse to mini mode. `WM_STYLECHANGING`
/// is the documented hook for amending a style change before it lands.
unsafe extern "system" fn window_switcher_subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    id: usize,
    _data: usize,
) -> LRESULT {
    match msg {
        WM_STYLECHANGING if wparam.0 as i32 == GWL_EXSTYLE.0 => {
            // SAFETY: for WM_STYLECHANGING lParam points at a STYLESTRUCT owned
            // by the caller for the duration of the message.
            if let Some(style) = unsafe { (lparam.0 as *mut STYLESTRUCT).as_mut() } {
                style.styleNew = switcher_hidden_ex_style(style.styleNew);
            }
        }
        WM_NCDESTROY => {
            let _ = unsafe { RemoveWindowSubclass(hwnd, Some(window_switcher_subclass_proc), id) };
        }
        _ => {}
    }
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

/// Main thread only: comctl32 subclassing works from the window's own thread,
/// and `create_main_window` already runs there. Called before the window is
/// first shown — the shell decides on the taskbar button when the window
/// becomes visible, and changing the style afterwards leaves a stale button.
pub fn hide_from_window_switcher(app: &AppHandle) {
    let Some(w) = main_window(app) else {
        return;
    };
    let Ok(hwnd) = w.hwnd() else {
        return;
    };
    unsafe {
        let _ = SetWindowSubclass(
            hwnd,
            Some(window_switcher_subclass_proc),
            WINDOW_SWITCHER_SUBCLASS_ID,
            0,
        );
        let current = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        SetWindowLongPtrW(
            hwnd,
            GWL_EXSTYLE,
            switcher_hidden_ex_style(current) as isize,
        );
        // The new frame style is applied only once the window is told the
        // frame changed.
        let _ = SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
        );
    }
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

/// No preflight on Windows: WASAPI reports a denied device when it is opened.
pub fn microphone_capture_access() -> Option<bool> {
    Some(true)
}

pub async fn request_microphone_capture_access() -> Result<bool, String> {
    Ok(true)
}
