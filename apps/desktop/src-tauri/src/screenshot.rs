use std::sync::atomic::{AtomicBool, Ordering};

use base64::Engine;
use tauri::AppHandle;

use crate::error::{AppError, ErrorCode};
use crate::{events, platform, window};

/// Чистая геометрия оверлея выделения: общая на платформы и покрытая тестами
/// там, где тесты вообще гоняются (macOS-раннер).
pub mod geom;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "macos")]
use macos as backend;
#[cfg(target_os = "windows")]
use windows as backend;

pub const SCREENSHOT_MEDIA_TYPE: &str = "image/png";

const LOG_TAG: &str = "[screenshot]";
const NO_PERMISSION_MESSAGE: &str =
    "Нет разрешения «Запись экрана». Выдай его в системных настройках и повтори.";

/// Захват модален: оверлей крутит собственный цикл событий на главном потоке,
/// и второй запуск (глобальный хоткей во время выделения) перетирал бы его
/// глобалы — внешний цикл переставал перерисовываться, снимок терялся.
static CAPTURING: AtomicBool = AtomicBool::new(false);

/// Кодирование base64 и декод PNG для буфера обмена — на blocking-пуле;
/// на главный поток возвращаются только сам буфер обмена и эмит.
fn deliver(app: AppHandle, png: Vec<u8>) {
    tauri::async_runtime::spawn_blocking(move || {
        let clipboard_image = tauri::image::Image::from_bytes(&png).ok();
        let data_base64 = base64::engine::general_purpose::STANDARD.encode(&png);
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Some(image) = clipboard_image {
                crate::clipboard::write_image(&handle, &image);
            }
            events::screenshot_ready(
                &handle,
                events::ScreenshotReady {
                    media_type: SCREENSHOT_MEDIA_TYPE.to_string(),
                    data_base64,
                },
            );
            window::show_and_focus_prompt(&handle);
        });
    });
}

pub fn on_capture_region(app: &AppHandle) {
    if !platform::screen_capture_access() {
        events::screenshot_error(
            app,
            AppError {
                code: ErrorCode::Permission,
                message: NO_PERMISSION_MESSAGE.to_string(),
            },
        );
        return;
    }
    if CAPTURING.swap(true, Ordering::AcqRel) {
        return;
    }
    let app = app.clone();
    let queued = app.clone().run_on_main_thread(move || {
        let hid_main_window = window::hide_main_window_for_capture(&app);
        let outcome = backend::capture_region();
        CAPTURING.store(false, Ordering::Release);
        if hid_main_window && !matches!(outcome, Ok(Some(_))) {
            window::show_and_focus_prompt(&app);
        }
        match outcome {
            Ok(Some(png)) => deliver(app, png),
            Ok(None) => {}
            Err(message) => {
                eprintln!("{LOG_TAG} {message}");
                events::screenshot_error(
                    &app,
                    AppError {
                        code: ErrorCode::Internal,
                        message,
                    },
                );
            }
        }
    });
    if queued.is_err() {
        CAPTURING.store(false, Ordering::Release);
    }
}

#[tauri::command]
#[specta::specta]
pub fn capture_region_screenshot(app: AppHandle) {
    on_capture_region(&app);
}
