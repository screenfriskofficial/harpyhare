use std::sync::atomic::Ordering;
use std::time::Duration;

use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::app_state::{current_settings, App};
use crate::{events, hotkey, identity, platform, plugins, settings, window_geom};

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

pub fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(MAIN_WINDOW_LABEL)
}

pub fn launcher_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LAUNCHER_WINDOW_LABEL)
}

fn window_title(app: &AppHandle, settings: &settings::Settings) -> String {
    identity::find(&settings.identity_id)
        .map(|d| d.display_name.to_string())
        .unwrap_or_else(|| app.package_info().name.clone())
}

fn apply_content_protection(w: &WebviewWindow, settings: &settings::Settings) {
    let _ = w.set_content_protected(!settings.screen_share_visible);
}

pub fn apply_content_protection_all(app: &AppHandle, settings: &settings::Settings) {
    for (_, w) in app.webview_windows() {
        apply_content_protection(&w, settings);
    }
}

pub fn create_launcher_window(app: &AppHandle, settings: &settings::Settings) -> Result<(), String> {
    if launcher_window(app).is_some() {
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(
        app,
        LAUNCHER_WINDOW_LABEL,
        tauri::WebviewUrl::App(LAUNCHER_WINDOW_URL.into()),
    )
    .title(window_title(app, settings))
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
    .content_protected(!settings.screen_share_visible)
    .build()
    .map_err(|e| e.to_string())?;
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
    .title(window_title(app, settings))
    .inner_size(settings.window_width, settings.window_height)
    .min_inner_size(
        settings::limits::window::WIDTH.min,
        settings::limits::window::HEIGHT.min,
    )
    .transparent(true)
    .decorations(false)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .content_protected(!settings.screen_share_visible)
    .center()
    .build()
    .map_err(|e| e.to_string())?;
    platform::clip_native_window_corners(app);
    Ok(())
}

pub fn register_main_window_hotkeys(app: &AppHandle, s: &settings::Settings) {
    if let Err(e) = hotkey::register_ptt(app, &s.hotkey) {
        eprintln!("не удалось зарегистрировать PTT-хоткей {:?}: {e}", s.hotkey);
    }
    if let Err(e) = hotkey::register_toggle(app, &s.toggle_hotkey) {
        eprintln!("не удалось зарегистрировать toggle-хоткей {:?}: {e}", s.toggle_hotkey);
    }
    if let Err(e) = hotkey::register_teleprompter(app, &s.teleprompter_hotkey) {
        eprintln!("не удалось зарегистрировать суфлёр-хоткей {:?}: {e}", s.teleprompter_hotkey);
    }
    register_plugin_hotkeys(app, s);
}

fn unregister_main_window_hotkeys(app: &AppHandle, s: &settings::Settings) {
    hotkey::unregister_ptt(app, &s.hotkey);
    hotkey::unregister_toggle(app, &s.toggle_hotkey);
    hotkey::unregister_teleprompter(app, &s.teleprompter_hotkey);
    hotkey::unregister_esc(app);
    unregister_plugin_hotkeys(app, s);
}

pub fn register_plugin_hotkeys(app: &AppHandle, s: &settings::Settings) {
    let registry = app.state::<App>().plugins.lock().unwrap().clone();
    for p in &registry {
        let Some(ps) = s.plugin_settings.iter().find(|x| x.id == p.manifest.id) else { continue };
        if !ps.enabled {
            continue;
        }
        let Some(shortcut) = hotkey::parse_hotkey(&ps.hotkey) else { continue };
        let id = p.manifest.id.clone();
        let res = app.global_shortcut().on_shortcut(shortcut, move |app, _sc, event| {
            if event.state == ShortcutState::Pressed {
                let app = app.clone();
                let id = id.clone();
                tauri::async_runtime::spawn(async move { plugins::on_activate(&app, &id).await });
            }
        });
        if let Err(e) = res {
            eprintln!("не удалось зарегистрировать хоткей плагина {}: {e}", p.manifest.id);
        }
    }
}

pub fn unregister_plugin_hotkeys(app: &AppHandle, s: &settings::Settings) {
    for ps in &s.plugin_settings {
        if let Some(shortcut) = hotkey::parse_hotkey(&ps.hotkey) {
            let _ = app.global_shortcut().unregister(shortcut);
        }
    }
}

pub fn on_toggle_visibility(app: &AppHandle) {
    if let Some(w) = main_window(app) {
        if w.is_visible().unwrap_or(true) {
            let _ = w.hide();
        } else {
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
}

pub fn show_and_focus_main(app: &AppHandle) {
    if let Some(w) = main_window(app) {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn on_toggle_teleprompter(app: &AppHandle) {
    events::toggle_teleprompter(app);
}

#[tauri::command]
#[specta::specta]
pub fn launch_main_window(app: AppHandle) -> Result<(), String> {
    let settings = current_settings(&app);
    create_main_window(&app, &settings)?;
    register_main_window_hotkeys(&app, &settings);
    if let Some(w) = launcher_window(&app) {
        let _ = w.destroy();
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn stop_main_window(app: AppHandle) -> Result<(), String> {
    let settings = current_settings(&app);
    unregister_main_window_hotkeys(&app, &settings);
    create_launcher_window(&app, &settings)?;
    if let Some(w) = main_window(&app) {
        let _ = w.destroy();
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn close_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
#[specta::specta]
pub fn hide_main_window(app: AppHandle) {
    if let Some(w) = main_window(&app) {
        let _ = w.hide();
    }
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

#[tauri::command]
#[specta::specta]
pub fn set_window_size(app: AppHandle, width: f64, height: f64) {
    let Some(w) = main_window(&app) else {
        return;
    };
    let scale = w.scale_factor().unwrap_or(1.0);
    let from_width = w.outer_size().map(|s| s.width as f64 / scale).unwrap_or(width);
    let from_height = w.outer_size().map(|s| s.height as f64 / scale).unwrap_or(height);
    let from_pos = w.outer_position().unwrap_or(tauri::PhysicalPosition::new(0, 0));

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

fn run_resize_tween(app: AppHandle, w: WebviewWindow, tween: ResizeTween, my_gen: u64) {
    for i in 1..=RESIZE_TWEEN_STEPS {
        if app.state::<App>().resize_gen.load(Ordering::SeqCst) != my_gen {
            return;
        }
        let eased = ease_out_cubic(f64::from(i) / f64::from(RESIZE_TWEEN_STEPS));
        let cur_w = tween.from_width + (tween.to_width - tween.from_width) * eased;
        let cur_h = tween.from_height + (tween.to_height - tween.from_height) * eased;
        let cur_x =
            (f64::from(tween.from_x) + f64::from(tween.to_x - tween.from_x) * eased).round() as i32;
        apply_window_frame(&app, &w, cur_x, tween.y, cur_w, cur_h);
        std::thread::sleep(RESIZE_TWEEN_FRAME_INTERVAL);
    }
    if app.state::<App>().resize_gen.load(Ordering::SeqCst) == my_gen {
        apply_window_frame(
            &app,
            &w,
            tween.to_x,
            tween.y,
            tween.to_width,
            tween.to_height,
        );
    }
}

fn apply_window_frame(app: &AppHandle, w: &WebviewWindow, x: i32, y: i32, width: f64, height: f64) {
    let win = w.clone();
    let _ = app.run_on_main_thread(move || {
        let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
        let _ = win.set_size(tauri::LogicalSize::new(width, height));
    });
}
