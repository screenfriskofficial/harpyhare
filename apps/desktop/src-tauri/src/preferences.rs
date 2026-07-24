use std::sync::Arc;

use tauri::{AppHandle, Manager};

use crate::app_state::{build_llm_client, build_stt_client, current_settings, settings_path, App};
use crate::recording::request_capture_rebuild;
use crate::window::main_window;
use crate::{access, hotkey, settings};

const ENV_FILE_NAME: &str = ".env";
const ANTHROPIC_API_KEY_ENV: &str = "ANTHROPIC_API_KEY";
const GROQ_API_KEY_ENV: &str = "GROQ_API_KEY";

pub fn load_dotenv_files() {
    let _ = dotenvy::dotenv();
    if let Some(project_env) = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|root| root.join(ENV_FILE_NAME))
    {
        let _ = dotenvy::from_path(project_env);
    }
}

pub fn load_settings_with_env_key_fallback(app: &AppHandle) -> settings::Settings {
    let mut settings = settings::Settings::load(&settings_path(app))
        .unwrap_or_else(|_| settings::Settings::default());
    settings.apply_key_fallback(
        std::env::var(ANTHROPIC_API_KEY_ENV).ok(),
        std::env::var(GROQ_API_KEY_ENV).ok(),
    );
    settings
}

#[tauri::command]
#[specta::specta]
pub fn get_settings(app: AppHandle) -> settings::Settings {
    current_settings(&app)
}

#[tauri::command]
#[specta::specta]
pub fn get_official_presets(app: AppHandle) -> Vec<settings::PromptPreset> {
    app.state::<App>().official_presets.lock().unwrap().clone()
}

#[tauri::command]
#[specta::specta]
pub fn set_settings(
    app: AppHandle,
    mut new_settings: settings::Settings,
) -> Result<settings::Settings, String> {
    new_settings.clamp();
    let st = app.state::<App>();
    let old = st.settings.lock().unwrap().clone();
    reregister_changed_hotkeys(&app, &old, &new_settings)?;
    rebuild_changed_api_clients(&st, &old, &new_settings);
    apply_screen_share_visibility_change(&app, &old, &new_settings);
    apply_buffer_settings_change(&app, &old, &new_settings);
    let capture_device_changed = old.capture_device_uid != new_settings.capture_device_uid;
    new_settings
        .save(&settings_path(&app))
        .map_err(|e| e.to_string())?;
    *st.settings.lock().unwrap() = new_settings.clone();
    if capture_device_changed {
        request_capture_rebuild(&app);
    }
    Ok(new_settings)
}

#[tauri::command]
#[specta::specta]
pub fn set_ptt_suspended(app: AppHandle, suspended: bool) {
    let hk = app.state::<App>().settings.lock().unwrap().hotkey.clone();
    if suspended {
        hotkey::unregister_ptt(&app, &hk);
    } else {
        let _ = hotkey::register_ptt(&app, &hk);
    }
}

#[tauri::command]
#[specta::specta]
pub async fn redeem_access_code(
    app: AppHandle,
    code: String,
    idempotency_key: String,
) -> Result<(), String> {
    let base_url = access::proxy_base_url();
    let token = access::redeem(&base_url, &code, &idempotency_key).await?;
    apply_access_token(&app, token)
}

fn apply_access_token(app: &AppHandle, token: String) -> Result<(), String> {
    let st = app.state::<App>();
    let old = st.settings.lock().unwrap().clone();
    let mut new_settings = old.clone();
    new_settings.access_token = token;
    new_settings
        .save(&settings_path(app))
        .map_err(|e| e.to_string())?;
    rebuild_changed_api_clients(&st, &old, &new_settings);
    *st.settings.lock().unwrap() = new_settings;
    Ok(())
}

fn reregister_changed_hotkeys(
    app: &AppHandle,
    old: &settings::Settings,
    new: &settings::Settings,
) -> Result<(), String> {
    if main_window(app).is_none() {
        return Ok(());
    }
    if old.hotkey != new.hotkey {
        hotkey::register_ptt(app, &new.hotkey)?;
        hotkey::unregister_ptt(app, &old.hotkey);
    }
    if old.toggle_hotkey != new.toggle_hotkey {
        hotkey::register_toggle(app, &new.toggle_hotkey)?;
        hotkey::unregister_toggle(app, &old.toggle_hotkey);
    }
    if old.teleprompter_hotkey != new.teleprompter_hotkey {
        hotkey::register_teleprompter(app, &new.teleprompter_hotkey)?;
        hotkey::unregister_teleprompter(app, &old.teleprompter_hotkey);
    }
    if old.plugin_settings != new.plugin_settings {
        crate::window::unregister_plugin_hotkeys(app, old);
        crate::window::register_plugin_hotkeys(app, new);
    }
    Ok(())
}

fn rebuild_changed_api_clients(st: &App, old: &settings::Settings, new: &settings::Settings) {
    let access_token_changed = old.access_token != new.access_token;
    if access_token_changed
        || old.groq_api_key != new.groq_api_key
        || old.stt_language != new.stt_language
        || old.stt_translate != new.stt_translate
    {
        *st.stt.lock().unwrap() = build_stt_client(new);
    }
    if access_token_changed || old.anthropic_api_key != new.anthropic_api_key {
        *st.llm.lock().unwrap() = build_llm_client(new, Arc::clone(&st.models));
    }
}

fn apply_screen_share_visibility_change(
    app: &AppHandle,
    old: &settings::Settings,
    new: &settings::Settings,
) {
    if old.screen_share_visible != new.screen_share_visible {
        crate::window::apply_content_protection_all(app, new);
    }
}

fn apply_buffer_settings_change(
    app: &AppHandle,
    old: &settings::Settings,
    new: &settings::Settings,
) {
    if old.buffer_enabled == new.buffer_enabled && old.buffer_seconds == new.buffer_seconds {
        return;
    }
    if let Some(c) = app.state::<App>().capture.lock().unwrap().as_ref() {
        c.set_buffer_capacity_secs(new.buffer_seconds.into());
        c.set_buffering(new.buffer_enabled);
    }
}

pub fn reapply_identity_if_needed(app: &AppHandle, settings: &settings::Settings) {
    if settings.identity_id.is_empty() {
        return;
    }
    let Some(def) = crate::identity::find(&settings.identity_id) else {
        return;
    };
    for (_, w) in app.webview_windows() {
        let _ = w.set_title(def.display_name);
    }
    let running_as_expected = std::env::current_exe()
        .ok()
        .and_then(|p| p.file_name().map(|n| n.to_os_string()))
        .is_some_and(|n| n == def.display_name);
    if running_as_expected {
        return;
    }
    let app = app.clone();
    let identity_id = settings.identity_id.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = crate::identity::apply(&app, &identity_id).await {
            eprintln!("[identity] авто-переприменение после обновления не удалось: {e}");
        }
    });
}
