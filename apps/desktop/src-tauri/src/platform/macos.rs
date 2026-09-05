use objc2_app_kit::NSEventModifierFlags;
use tauri::AppHandle;

use super::{handle_arrow_key, ModifierMask, WINDOW_CORNER_RADIUS_LOGICAL_PX};
use crate::window::{launcher_window, main_window};

const KEY_CODE_ARROW_LEFT: u16 = 123;
const KEY_CODE_ARROW_RIGHT: u16 = 124;
const KEY_CODE_ARROW_DOWN: u16 = 125;
const KEY_CODE_ARROW_UP: u16 = 126;

const OPEN_COMMAND: &str = "open";
const AUDIO_CAPTURE_PRIVACY_PANE_URL: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_AudioCapture";
const SCREEN_CAPTURE_PRIVACY_PANE_URL: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";

pub fn disable_cursor_autohide_on_typing() {
    unsafe extern "C-unwind" fn keep_cursor_visible() {}

    let Some(cursor_class) = objc2::runtime::AnyClass::get(c"NSCursor") else {
        return;
    };
    let Some(method) = cursor_class
        .metaclass()
        .instance_method(objc2::sel!(setHiddenUntilMouseMoves:))
    else {
        return;
    };
    unsafe {
        let _ = objc2::ffi::method_setImplementation(
            std::ptr::from_ref(method).cast(),
            keep_cursor_visible,
        );
    }
}

const STYLE_MASK_FULL_SIZE_CONTENT_VIEW: usize = 1 << 15;
const TITLE_VISIBILITY_HIDDEN: isize = 1;

pub fn merge_titlebar_into_content(app: &AppHandle) {
    use objc2::{msg_send, runtime::AnyObject};
    let Some(w) = launcher_window(app) else {
        return;
    };
    let Ok(ns_window) = w.ns_window() else {
        return;
    };
    let ns_window = ns_window.cast::<AnyObject>();
    unsafe {
        let mask: usize = msg_send![ns_window, styleMask];
        let _: () = msg_send![ns_window, setStyleMask: mask | STYLE_MASK_FULL_SIZE_CONTENT_VIEW];
        let _: () = msg_send![ns_window, setTitlebarAppearsTransparent: true];
        let _: () = msg_send![ns_window, setTitleVisibility: TITLE_VISIBILITY_HIDDEN];
    }
}

pub fn clip_native_window_corners(app: &AppHandle) {
    use objc2::{msg_send, runtime::AnyObject};
    let Some(w) = main_window(app) else {
        return;
    };
    let Ok(ns_window) = w.ns_window() else {
        return;
    };
    let ns_window = ns_window.cast::<AnyObject>();
    unsafe {
        let content_view: *mut AnyObject = msg_send![ns_window, contentView];
        if content_view.is_null() {
            return;
        }
        let _: () = msg_send![content_view, setWantsLayer: true];
        let layer: *mut AnyObject = msg_send![content_view, layer];
        if layer.is_null() {
            return;
        }
        let _: () = msg_send![layer, setCornerRadius: WINDOW_CORNER_RADIUS_LOGICAL_PX];
        let _: () = msg_send![layer, setMasksToBounds: true];
    }
}

fn mask_from_flags(flags: NSEventModifierFlags) -> ModifierMask {
    let mut mask = ModifierMask::EMPTY;
    if flags.contains(NSEventModifierFlags::Command) {
        mask |= ModifierMask::CMD;
    }
    if flags.contains(NSEventModifierFlags::Control) {
        mask |= ModifierMask::CTRL;
    }
    if flags.contains(NSEventModifierFlags::Option) {
        mask |= ModifierMask::ALT;
    }
    if flags.contains(NSEventModifierFlags::Shift) {
        mask |= ModifierMask::SHIFT;
    }
    mask
}

pub fn install_move_keys_monitor(app: AppHandle) {
    use objc2_app_kit::{NSEvent, NSEventMask};

    let block = block2::RcBlock::new(move |ev: std::ptr::NonNull<NSEvent>| -> *mut NSEvent {
        let pass = ev.as_ptr();
        let event = unsafe { ev.as_ref() };
        let (dx, dy) = match event.keyCode() {
            KEY_CODE_ARROW_LEFT => (-1i32, 0i32),
            KEY_CODE_ARROW_RIGHT => (1, 0),
            KEY_CODE_ARROW_DOWN => (0, 1),
            KEY_CODE_ARROW_UP => (0, -1),
            _ => return pass,
        };
        if handle_arrow_key(&app, mask_from_flags(event.modifierFlags()), dx, dy) {
            return std::ptr::null_mut();
        }
        pass
    });
    let monitor = unsafe {
        NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::KeyDown, &block)
    };
    std::mem::forget(monitor);
}

/// `open` возвращается сразу, но дочерний процесс кто-то обязан дождаться:
/// без `wait` каждый клик по ссылке оставлял `<defunct>` до выхода из приложения.
fn open_with_shell(target: &str) {
    if let Ok(mut child) = std::process::Command::new(OPEN_COMMAND).arg(target).spawn() {
        std::thread::spawn(move || {
            let _ = child.wait();
        });
    }
}

pub fn open_audio_capture_privacy_pane() {
    open_with_shell(AUDIO_CAPTURE_PRIVACY_PANE_URL);
}

pub fn open_screen_capture_privacy_pane() {
    open_with_shell(SCREEN_CAPTURE_PRIVACY_PANE_URL);
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

pub fn screen_capture_access() -> bool {
    unsafe { CGPreflightScreenCaptureAccess() }
}

pub fn request_screen_capture_access() -> bool {
    unsafe { CGRequestScreenCaptureAccess() }
}

pub fn open_url(url: &str) {
    open_with_shell(url);
}
