use std::sync::atomic::Ordering;
use std::time::Duration;

use tauri::{AppHandle, Manager, WebviewWindow};

use crate::app_state::{current_settings, App};
use crate::{events, global_shortcuts, hotkeys, platform, settings, window_geom};

pub const MAIN_WINDOW_LABEL: &str = "main";
pub const LAUNCHER_WINDOW_LABEL: &str = "launcher";

const MAIN_WINDOW_URL: &str = "index.html";
const LAUNCHER_WINDOW_URL: &str = "launcher.html";
const LAUNCHER_WINDOW_WIDTH_LOGICAL_PX: f64 = 1000.0;
const LAUNCHER_WINDOW_HEIGHT_LOGICAL_PX: f64 = 720.0;
const LAUNCHER_WINDOW_MIN_WIDTH_LOGICAL_PX: f64 = 520.0;
const LAUNCHER_WINDOW_MIN_HEIGHT_LOGICAL_PX: f64 = 480.0;

const RESIZE_TWEEN_STEPS: u32 = 14;
const RESIZE_TWEEN_FRAME_INTERVAL: Duration = Duration::from_millis(13);
const RESIZE_EPSILON_LOGICAL_PX: f64 = 1.0;

const MINI_WINDOW_WIDTH_LOGICAL_PX: f64 = 168.0;
const MINI_WINDOW_HEIGHT_LOGICAL_PX: f64 = 48.0;
const MINI_MIN_SIZE_RESTORE_DELAY: Duration =
    RESIZE_TWEEN_FRAME_INTERVAL.saturating_mul(RESIZE_TWEEN_STEPS * 2);

pub fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(MAIN_WINDOW_LABEL)
}

pub fn launcher_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LAUNCHER_WINDOW_LABEL)
}

fn window_title(app: &AppHandle) -> String {
    app.package_info().name.clone()
}

fn apply_content_protection(w: &WebviewWindow, settings: &settings::Settings) {
    let _ = w.set_content_protected(!settings.screen_share_visible);
}

pub fn apply_content_protection_all(app: &AppHandle, settings: &settings::Settings) {
    for (_, w) in app.webview_windows() {
        apply_content_protection(&w, settings);
    }
}

pub fn create_launcher_window(
    app: &AppHandle,
    settings: &settings::Settings,
) -> Result<(), String> {
    if launcher_window(app).is_some() {
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(
        app,
        LAUNCHER_WINDOW_LABEL,
        tauri::WebviewUrl::App(LAUNCHER_WINDOW_URL.into()),
    )
    .title(window_title(app))
    .inner_size(
        LAUNCHER_WINDOW_WIDTH_LOGICAL_PX,
        LAUNCHER_WINDOW_HEIGHT_LOGICAL_PX,
    )
    .min_inner_size(
        LAUNCHER_WINDOW_MIN_WIDTH_LOGICAL_PX,
        LAUNCHER_WINDOW_MIN_HEIGHT_LOGICAL_PX,
    )
    .resizable(true)
    .center()
    .theme(Some(tauri::Theme::Dark))
    .shadow(false)
    .content_protected(!settings.screen_share_visible)
    .build()
    .map_err(|e| e.to_string())?;
    platform::merge_titlebar_into_content(app);
    Ok(())
}

fn create_main_window(app: &AppHandle, settings: &settings::Settings) -> Result<(), String> {
    if main_window(app).is_some() {
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(
        app,
        MAIN_WINDOW_LABEL,
        tauri::WebviewUrl::App(MAIN_WINDOW_URL.into()),
    )
    .title(window_title(app))
    .inner_size(settings.window_width, settings.window_height)
    .min_inner_size(
        settings::limits::window::WIDTH.min,
        settings::limits::window::HEIGHT.min,
    )
    .transparent(true)
    .decorations(false)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .shadow(false)
    .content_protected(!settings.screen_share_visible)
    .center()
    .build()
    .map_err(|e| e.to_string())?;
    app.state::<App>()
        .window_mini
        .store(false, Ordering::SeqCst);
    platform::clip_native_window_corners(app);
    Ok(())
}

type GlobalRegistrar = fn(&AppHandle, &str) -> Result<(), String>;

/// Глобальные действия и их регистраторы. Снятие у всех одно —
/// `global_shortcuts::unregister` по сочетанию.
const GLOBAL_HOTKEYS: &[(&str, GlobalRegistrar)] = &[
    (hotkeys::ACTION_RECORD, global_shortcuts::register_ptt),
    (
        hotkeys::ACTION_TOGGLE_WINDOW,
        global_shortcuts::register_toggle,
    ),
    (
        hotkeys::ACTION_TELEPROMPTER,
        global_shortcuts::register_teleprompter,
    ),
    (
        hotkeys::ACTION_SCREENSHOT,
        global_shortcuts::register_screenshot,
    ),
    (
        hotkeys::ACTION_FOCUS_PROMPT,
        global_shortcuts::register_focus_prompt,
    ),
    (
        hotkeys::ACTION_DUPLICATE_CHAT,
        global_shortcuts::register_duplicate_chat,
    ),
];

/// Регистрирует глобальные хоткеи HUD. Каждый провал уходит пользователю
/// событием `hotkey-error`: раньше он оседал в stderr, которого в релизе нет,
/// и занятое другим приложением сочетание (PTT на `Ctrl+R` у Discord) просто
/// молча не работало.
pub fn register_main_window_hotkeys(app: &AppHandle, s: &settings::Settings) {
    for (action, register) in GLOBAL_HOTKEYS {
        let combo = hotkeys::effective(&s.hotkeys, action);
        if combo.is_empty() {
            continue;
        }
        if let Err(e) = register(app, &combo) {
            let label = hotkeys::action(action).map_or(*action, |a| a.label);
            events::hotkey_error(
                app,
                crate::error::AppError::new(
                    crate::error::ErrorCode::Internal,
                    format!("Сочетание {combo} для «{label}» не зарегистрировано: {e}"),
                ),
            );
        }
    }
}

pub fn unregister_main_window_hotkeys_for(app: &AppHandle, s: &settings::Settings) {
    for (action, _) in GLOBAL_HOTKEYS {
        let combo = hotkeys::effective(&s.hotkeys, action);
        if !combo.is_empty() {
            global_shortcuts::unregister(app, &combo);
        }
    }
    global_shortcuts::unregister_cancel(
        app,
        &hotkeys::effective(&s.hotkeys, hotkeys::ACTION_CANCEL_RECORDING),
    );
}

pub fn hide_main_window_for_capture(app: &AppHandle) -> bool {
    match main_window(app) {
        Some(w) if w.is_visible().unwrap_or(false) => {
            let _ = w.hide();
            true
        }
        _ => false,
    }
}

pub fn show_and_focus_prompt(app: &AppHandle) {
    if let Some(w) = main_window(app) {
        let _ = w.show();
        let _ = w.set_focus();
        events::focus_prompt(app);
    }
}

pub fn on_toggle_mini(app: &AppHandle) {
    if let Some(w) = main_window(app) {
        if !w.is_visible().unwrap_or(true) {
            let _ = w.show();
        }
        events::toggle_mini(app);
    }
}

pub fn on_duplicate_chat(app: &AppHandle) {
    if main_window(app).is_none() {
        return;
    }
    show_and_focus_prompt(app);
    crate::events::duplicate_chat(app);
}

pub fn on_toggle_teleprompter(app: &AppHandle) {
    events::toggle_teleprompter(app);
}

async fn on_main_thread<F>(app: &AppHandle, work: F) -> Result<(), String>
where
    F: FnOnce(&AppHandle) -> Result<(), String> + Send + 'static,
{
    let (done, wait) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = done.send(work(&handle));
    })
    .map_err(|e| e.to_string())?;
    wait.await.map_err(|e| e.to_string())?
}

fn swap_to_main_window(app: &AppHandle) -> Result<(), String> {
    if main_window(app).is_some() {
        // Окно уже есть — хоткеи уже зарегистрированы; повтор регистрации
        // здесь и в плагине не бесплатен.
        return Ok(());
    }
    let settings = current_settings(app);
    create_main_window(app, &settings)?;
    register_main_window_hotkeys(app, &settings);
    app.state::<App>()
        .recording_enabled
        .store(true, Ordering::Release);
    if let Some(w) = launcher_window(app) {
        let _ = w.destroy();
    }
    let capture_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::recording::ensure_capture(&capture_app);
    });
    Ok(())
}

fn swap_to_launcher_window(app: &AppHandle) -> Result<(), String> {
    let settings = current_settings(app);
    create_launcher_window(app, &settings)?;
    crate::recording::stop_for_launcher(app);
    // Окна больше нет — некому читать дельты; недочитанная генерация иначе
    // шла бы до конца и оплачивалась (и на relay тоже).
    crate::chat::cancel_all_streams(app);
    unregister_main_window_hotkeys_for(app, &settings);
    if let Some(w) = main_window(app) {
        let _ = w.destroy();
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn launch_main_window(app: AppHandle) -> Result<(), String> {
    on_main_thread(&app, swap_to_main_window).await
}

#[tauri::command]
#[specta::specta]
pub async fn stop_main_window(app: AppHandle) -> Result<(), String> {
    on_main_thread(&app, swap_to_launcher_window).await
}

#[tauri::command]
#[specta::specta]
pub fn close_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
#[specta::specta]
pub fn collapse_main_window(app: AppHandle) {
    let Some(w) = main_window(&app) else {
        return;
    };
    app.state::<App>().window_mini.store(true, Ordering::SeqCst);
    let _ = w.set_min_size(Some(tauri::LogicalSize::new(
        MINI_WINDOW_WIDTH_LOGICAL_PX,
        MINI_WINDOW_HEIGHT_LOGICAL_PX,
    )));
    let _ = w.set_resizable(false);
    set_window_size(
        app,
        MINI_WINDOW_WIDTH_LOGICAL_PX,
        MINI_WINDOW_HEIGHT_LOGICAL_PX,
    );
}

#[tauri::command]
#[specta::specta]
pub fn expand_main_window(app: AppHandle, width: f64, height: f64) {
    let Some(w) = main_window(&app) else {
        return;
    };
    app.state::<App>()
        .window_mini
        .store(false, Ordering::SeqCst);
    let _ = w.set_resizable(true);
    let _ = w.show();
    let _ = w.set_focus();
    set_window_size(app.clone(), width, height);
    std::thread::spawn(move || {
        std::thread::sleep(MINI_MIN_SIZE_RESTORE_DELAY);
        if app.state::<App>().window_mini.load(Ordering::SeqCst) {
            return;
        }
        if let Some(w) = main_window(&app) {
            let _ = w.set_min_size(Some(tauri::LogicalSize::new(
                settings::limits::window::WIDTH.min,
                settings::limits::window::HEIGHT.min,
            )));
        }
    });
}

struct ResizeTween {
    from_width: f64,
    to_width: f64,
    from_height: f64,
    to_height: f64,
    from_x: i32,
    to_x: i32,
    y: i32,
}

/// Кадр твина: (ширина, высота, x) для шага `step` из `RESIZE_TWEEN_STEPS`.
fn tween_frame(tween: &ResizeTween, step: u32) -> (f64, f64, i32) {
    let eased = ease_out_cubic(f64::from(step) / f64::from(RESIZE_TWEEN_STEPS));
    let width = tween.from_width + (tween.to_width - tween.from_width) * eased;
    let height = tween.from_height + (tween.to_height - tween.from_height) * eased;
    let x = (f64::from(tween.from_x) + f64::from(tween.to_x - tween.from_x) * eased).round() as i32;
    (width, height, x)
}

/// Сколько ждать главный поток за одним кадром твина: дольше — значит он
/// занят чем-то тяжёлым, и анимацию честнее бросить, чем копить кадры.
const RESIZE_FRAME_ACK_TIMEOUT: Duration = Duration::from_millis(500);

#[tauri::command]
#[specta::specta]
pub fn set_window_size(app: AppHandle, width: f64, height: f64) {
    let Some(w) = main_window(&app) else {
        return;
    };
    let scale = w.scale_factor().unwrap_or(1.0);
    let (width, height) = clamped_to_work_area(&w, scale, width, height);
    let from_width = w
        .inner_size()
        .map(|s| s.width as f64 / scale)
        .unwrap_or(width);
    let from_height = w
        .inner_size()
        .map(|s| s.height as f64 / scale)
        .unwrap_or(height);
    let from_pos = w
        .outer_position()
        .unwrap_or(tauri::PhysicalPosition::new(0, 0));

    if (from_width - width).abs() < RESIZE_EPSILON_LOGICAL_PX
        && (from_height - height).abs() < RESIZE_EPSILON_LOGICAL_PX
    {
        return;
    }

    let my_gen = app.state::<App>().resize_gen.fetch_add(1, Ordering::SeqCst) + 1;
    let tween = ResizeTween {
        from_width,
        to_width: width,
        from_height,
        to_height: height,
        from_x: from_pos.x,
        to_x: anchored_target_x(&w, from_pos.x, width, scale),
        y: from_pos.y,
    };
    std::thread::spawn(move || run_resize_tween(app, w, tween, my_gen));
}

fn clamped_to_work_area(w: &WebviewWindow, scale: f64, width: f64, height: f64) -> (f64, f64) {
    let Some(monitor) = w.current_monitor().ok().flatten() else {
        return (width, height);
    };
    let area = monitor.work_area().size;
    window_geom::clamp_window_size(
        width,
        height,
        f64::from(area.width) / scale,
        f64::from(area.height) / scale,
    )
}

fn anchored_target_x(w: &WebviewWindow, from_x: i32, width: f64, scale: f64) -> i32 {
    let target_phys_w = (width * scale).round() as u32;
    let (mon_x, mon_w) = w
        .current_monitor()
        .ok()
        .flatten()
        .map(|m| (m.position().x, m.size().width))
        .unwrap_or((from_x, target_phys_w));
    window_geom::clamp_window_x(from_x, target_phys_w, mon_x, mon_w)
}

fn ease_out_cubic(t: f64) -> f64 {
    1.0 - (1.0 - t).powi(3)
}

fn frame_still_ours(w: &WebviewWindow, width: f64, height: f64) -> bool {
    let scale = w.scale_factor().unwrap_or(1.0);
    let Ok(size) = w.inner_size() else {
        return true;
    };
    (f64::from(size.width) / scale - width).abs() < RESIZE_EPSILON_LOGICAL_PX
        && (f64::from(size.height) / scale - height).abs() < RESIZE_EPSILON_LOGICAL_PX
}

fn tween_superseded(
    app: &AppHandle,
    w: &WebviewWindow,
    my_gen: u64,
    applied: Option<(f64, f64)>,
) -> bool {
    if app.state::<App>().resize_gen.load(Ordering::SeqCst) != my_gen {
        return true;
    }
    applied.is_some_and(|(width, height)| !frame_still_ours(w, width, height))
}

/// Один переход на главный поток за кадр: и проверка «кадр ещё наш», и
/// применение размера идут одним замыканием. Раньше `scale_factor()` и
/// `inner_size()` из фонового потока были двумя блокирующими round-trip'ами
/// сверх самого `run_on_main_thread` — три хода на каждые 13 мс.
fn run_resize_tween(app: AppHandle, w: WebviewWindow, tween: ResizeTween, my_gen: u64) {
    let mut applied: Option<(f64, f64)> = None;
    for step in 1..=RESIZE_TWEEN_STEPS {
        let (width, height, x) = tween_frame(&tween, step);
        if !apply_frame_if_still_ours(&app, &w, my_gen, applied, x, tween.y, width, height) {
            return;
        }
        applied = Some((width, height));
        std::thread::sleep(RESIZE_TWEEN_FRAME_INTERVAL);
    }
    apply_frame_if_still_ours(
        &app,
        &w,
        my_gen,
        applied,
        tween.to_x,
        tween.y,
        tween.to_width,
        tween.to_height,
    );
}

#[allow(clippy::too_many_arguments)]
fn apply_frame_if_still_ours(
    app: &AppHandle,
    w: &WebviewWindow,
    my_gen: u64,
    applied: Option<(f64, f64)>,
    x: i32,
    y: i32,
    width: f64,
    height: f64,
) -> bool {
    let (ack, wait) = std::sync::mpsc::channel();
    let win = w.clone();
    let handle = app.clone();
    let queued = app.run_on_main_thread(move || {
        let ours = !tween_superseded(&handle, &win, my_gen, applied);
        if ours {
            apply_window_frame_now(&win, x, y, width, height);
        }
        let _ = ack.send(ours);
    });
    if queued.is_err() {
        return false;
    }
    wait.recv_timeout(RESIZE_FRAME_ACK_TIMEOUT).unwrap_or(false)
}

/// Только с главного потока: применяет позицию (если она реально отличается —
/// лишний `SetWindowPos` дёргает начало координат при протяжке) и размер.
fn apply_window_frame_now(win: &WebviewWindow, x: i32, y: i32, width: f64, height: f64) {
    if win.outer_position().is_ok_and(|p| p.x != x || p.y != y) {
        let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
    }
    let _ = win.set_size(tauri::LogicalSize::new(width, height));
}

#[cfg(test)]
mod tests;
