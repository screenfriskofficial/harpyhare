use std::sync::Arc;

use tauri::{AppHandle, Manager};

use crate::app_state::{build_llm_client, build_stt_client, current_settings, settings_path, App};
use crate::recording::request_capture_rebuild;
use crate::window::main_window;
use crate::{access, hotkey, settings};

const ENV_FILE_NAME: &str = ".env";
const ANTHROPIC_API_KEY_ENV: &str = "ANTHROPIC_API_KEY";
const GROQ_API_KEY_ENV: &str = "GROQ_API_KEY";
const OPENAI_API_KEY_ENV: &str = "OPENAI_API_KEY";
const XAI_API_KEY_ENV: &str = "XAI_API_KEY";
const DEEPGRAM_API_KEY_ENV: &str = "DEEPGRAM_API_KEY";
const XCLIS_API_KEY_ENV: &str = "XCLIS_API_KEY";
const OPENROUTER_API_KEY_ENV: &str = "OPENROUTER_API_KEY";

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
        std::env::var(OPENAI_API_KEY_ENV).ok(),
        std::env::var(XAI_API_KEY_ENV).ok(),
        std::env::var(DEEPGRAM_API_KEY_ENV).ok(),
        std::env::var(XCLIS_API_KEY_ENV).ok(),
        std::env::var(OPENROUTER_API_KEY_ENV).ok(),
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
    let _edit = st.settings_edit.lock().unwrap();
    let old = st.settings.lock().unwrap().clone();
    let capture_device_changed = old.capture_device_uid != new_settings.capture_device_uid;
    let hotkeys_changed = old.hotkeys != new_settings.hotkeys;
    reregister_changed_hotkeys(&app, &old, &new_settings)?;
    if let Err(error) = new_settings.save(&settings_path(&app)) {
        if hotkeys_changed {
            crate::window::unregister_main_window_hotkeys_for(&app, &new_settings);
            let _ = crate::window::register_main_window_hotkeys(&app, &old);
        }
        return Err(error.to_string());
    }
    rebuild_changed_api_clients(&st, &old, &new_settings);
    apply_screen_share_visibility_change(&app, &old, &new_settings);
    apply_buffer_settings_change(&app, &old, &new_settings);
    *st.settings.lock().unwrap() = new_settings.clone();
    if capture_device_changed {
        request_capture_rebuild(&app);
    }
    Ok(new_settings)
}

/// Pushed by the frontend whenever the active chat (or its prompt) changes.
///
/// Not persisted and not part of `Settings`: these terms are read out of the
/// prompt the user is already writing, and they follow the active chat rather
/// than the installation.
#[tauri::command]
#[specta::specta]
pub fn set_stt_keyterms(app: AppHandle, keyterms: Vec<String>) {
    *app.state::<App>().stt_keyterms.lock().unwrap() = keyterms;
}

#[tauri::command]
#[specta::specta]
pub fn set_ptt_suspended(app: AppHandle, suspended: bool) {
    let settings = app.state::<App>().settings.lock().unwrap().clone();
    let system = crate::hotkeys::effective(&settings.hotkeys, crate::hotkeys::ACTION_RECORD);
    let microphone =
        crate::hotkeys::effective(&settings.hotkeys, crate::hotkeys::ACTION_RECORD_MICROPHONE);
    if suspended {
        hotkey::unregister_ptt(&app, &system);
        hotkey::unregister_ptt(&app, &microphone);
    } else {
        let _ = hotkey::register_system_ptt(&app, &system);
        let _ = hotkey::register_microphone_ptt(&app, &microphone);
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
    let _edit = st.settings_edit.lock().unwrap();
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
    if old.hotkeys != new.hotkeys {
        crate::window::unregister_main_window_hotkeys_for(app, old);
        if let Err(error) = crate::window::register_main_window_hotkeys(app, new) {
            let _ = crate::window::register_main_window_hotkeys(app, old);
            return Err(error);
        }
    }
    Ok(())
}

fn rebuild_changed_api_clients(st: &App, old: &settings::Settings, new: &settings::Settings) {
    let access_token_changed = old.access_token != new.access_token;
    if access_token_changed
        || stt_credentials_changed(old, new)
        || old.stt_provider != new.stt_provider
        || old.stt_language != new.stt_language
        || old.stt_translate != new.stt_translate
    {
        let rebuilt = build_stt_client(new);
        *st.stt.lock().unwrap() = Arc::clone(&rebuilt);
        tauri::async_runtime::spawn(async move { rebuilt.warm_up().await });
    }
    if access_token_changed || llm_credentials_changed(old, new) {
        *st.llm.lock().unwrap() = build_llm_client(new, Arc::clone(&st.models));
    }
}

/// Any key some answer vendor depends on. Reads the registry instead of naming
/// fields, so a vendor added there starts rebuilding its client on a key edit
/// without anyone remembering to extend this condition.
fn llm_credentials_changed(old: &settings::Settings, new: &settings::Settings) -> bool {
    crate::llm::registry::PROVIDERS.iter().any(|spec| {
        settings::api_key_for(old, spec.key_id) != settings::api_key_for(new, spec.key_id)
    })
}

/// The speech half of the same rule — see `llm_credentials_changed`.
fn stt_credentials_changed(old: &settings::Settings, new: &settings::Settings) -> bool {
    crate::stt::registry::PROVIDERS.iter().any(|spec| {
        settings::api_key_for(old, spec.key_id) != settings::api_key_for(new, spec.key_id)
    })
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

#[cfg(test)]
mod tests;
