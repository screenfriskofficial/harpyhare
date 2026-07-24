use tauri::{AppHandle, Manager};

use crate::app_state::App;
use crate::events;
use crate::window::main_window;

pub const WINDOW_CORNER_RADIUS_LOGICAL_PX: f64 = 22.0;

const KEY_CODE_ARROW_LEFT: u16 = 123;
const KEY_CODE_ARROW_RIGHT: u16 = 124;
const KEY_CODE_ARROW_DOWN: u16 = 125;
const KEY_CODE_ARROW_UP: u16 = 126;

const OPEN_COMMAND: &str = "open";
const AUDIO_CAPTURE_PRIVACY_PANE_URL: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_AudioCapture";
const SCREEN_CAPTURE_PRIVACY_PANE_URL: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
const HTTPS_URL_PREFIX: &str = "https://";
const HTTP_URL_PREFIX: &str = "http://";

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

fn modifier_mask(spec: &str) -> objc2_app_kit::NSEventModifierFlags {
    use objc2_app_kit::NSEventModifierFlags as F;
    let mut mask = F::empty();
    for part in spec.split('+') {
        match part.trim() {
            "Cmd" => mask |= F::Command,
            "Ctrl" => mask |= F::Control,
            "Alt" => mask |= F::Option,
            "Shift" => mask |= F::Shift,
            _ => {}
        }
    }
    mask
}

pub fn install_move_keys_monitor(app: AppHandle) {
    use objc2_app_kit::{NSEvent, NSEventMask, NSEventModifierFlags};

    let relevant = NSEventModifierFlags::Command
        | NSEventModifierFlags::Control
        | NSEventModifierFlags::Option
        | NSEventModifierFlags::Shift;

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
        let active = event.modifierFlags() & relevant;
        if active.is_empty() {
            return pass;
        }
        let (move_mask, resize_mask, step) = {
            let st = app.state::<App>();
            let s = st.settings.lock().unwrap();
            (
                modifier_mask(&s.move_modifier),
                modifier_mask(&s.resize_modifier),
                s.move_step as i32,
            )
        };
        let Some(w) = main_window(&app) else {
            return pass;
        };
        if active == move_mask {
            if let Ok(pos) = w.outer_position() {
                let _ = w.set_position(tauri::PhysicalPosition::new(
                    pos.x + dx * step,
                    pos.y + dy * step,
                ));
            }
            return std::ptr::null_mut();
        }
        if active == resize_mask {
            events::resize_key(&app, dx, dy);
            return std::ptr::null_mut();
        }
        pass
    });
    let monitor =
        unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::KeyDown, &block) };
    std::mem::forget(monitor);
}

pub fn open_audio_capture_privacy_pane() {
    let _ = std::process::Command::new(OPEN_COMMAND)
        .arg(AUDIO_CAPTURE_PRIVACY_PANE_URL)
        .spawn();
}

pub fn open_screen_capture_privacy_pane() {
    let _ = std::process::Command::new(OPEN_COMMAND)
        .arg(SCREEN_CAPTURE_PRIVACY_PANE_URL)
        .spawn();
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

fn is_web_url(url: &str) -> bool {
    url.starts_with(HTTPS_URL_PREFIX) || url.starts_with(HTTP_URL_PREFIX)
}

pub fn open_web_url(url: &str) {
    if is_web_url(url) {
        let _ = std::process::Command::new(OPEN_COMMAND).arg(url).spawn();
    }
}

#[cfg(test)]
mod tests;
