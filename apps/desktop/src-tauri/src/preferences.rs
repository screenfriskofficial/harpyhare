use crate::sync::LockUnpoisoned;
use std::sync::Arc;

use tauri::{AppHandle, Manager};

use crate::app_state::{build_llm_client, build_stt_client, current_settings, settings_path, App};
use crate::recording::request_capture_rebuild;
use crate::window::main_window;
use crate::{access, global_shortcuts, settings};

const ENV_FILE_NAME: &str = ".env";
/// Переменная окружения ключа вендора: `<KEY_ID в верхнем регистре>_API_KEY`
/// (`ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY`, …) — то же соглашение, по которому
/// ключи подхватывают смоуки в `examples/`.
const ENV_API_KEY_SUFFIX: &str = "_API_KEY";

pub fn load_dotenv_files() {
    let _ = dotenvy::dotenv();
    if let Some(project_env) = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|root| root.join(ENV_FILE_NAME))
    {
        let _ = dotenvy::from_path(project_env);
    }
}

pub fn env_api_key_name(key_id: &str) -> String {
    format!("{}{ENV_API_KEY_SUFFIX}", key_id.to_ascii_uppercase())
}

fn env_api_key(key_id: &str) -> Option<String> {
    std::env::var(env_api_key_name(key_id)).ok()
}

pub fn load_settings_with_env_key_fallback(app: &AppHandle) -> settings::Settings {
    let mut settings = settings::Settings::load_or_quarantine(&settings_path(app));
    settings.apply_key_fallback(env_api_key);
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
    app.state::<App>()
        .official_presets
        .lock_unpoisoned()
        .clone()
}

#[tauri::command]
#[specta::specta]
pub fn set_settings(
    app: AppHandle,
    mut new_settings: settings::Settings,
) -> Result<settings::Settings, String> {
    new_settings.clamp();
    let st = app.state::<App>();
    let _edit = st.settings_edit.lock_unpoisoned();
    let old = st.settings.lock_unpoisoned().clone();
    // Токен доступа принадлежит бэкенду: его выдаёт `redeem_access_code`, а
    // снимает `clear_access_token`. Снимок из лаунчера может быть старше
    // токена (автосейв, взведённый до активации кода), и принять его значение
    // значило бы стереть только что выданный токен — а код на relay уже потрачен.
    new_settings.access_token = old.access_token.clone();
    let capture_device_changed = old.capture_device_uid != new_settings.capture_device_uid
        || old.capture_system_audio != new_settings.capture_system_audio;
    new_settings
        .save(&settings_path(&app))
        .map_err(|e| e.to_string())?;
    reregister_changed_hotkeys(&app, &old, &new_settings);
    rebuild_changed_api_clients(&st, &old, &new_settings);
    apply_screen_share_visibility_change(&app, &old, &new_settings);
    apply_buffer_settings_change(&app, &old, &new_settings);
    *st.settings.lock_unpoisoned() = new_settings.clone();
    drop(_edit);
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
    *app.state::<App>().stt_keyterms.lock_unpoisoned() = keyterms;
}

#[tauri::command]
#[specta::specta]
pub fn set_ptt_suspended(app: AppHandle, suspended: bool) {
    let hk = crate::hotkeys::effective(
        &app.state::<App>().settings.lock_unpoisoned().hotkeys,
        crate::hotkeys::ACTION_RECORD,
    );
    if suspended {
        global_shortcuts::unregister(&app, &hk);
    } else {
        let _ = global_shortcuts::register_ptt(&app, &hk);
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
    apply_access_token(&app, token).map(|_| ())
}

/// Единственный способ отвязать код доступа. Через `set_settings` это сделать
/// нельзя намеренно: тот сохраняет токен из текущего состояния, а не из снимка
/// лаунчера (см. комментарий там). Возвращает применённые настройки, как и
/// `set_settings`, — фронт принимает их как новое состояние.
#[tauri::command]
#[specta::specta]
pub fn clear_access_token(app: AppHandle) -> Result<settings::Settings, String> {
    apply_access_token(&app, String::new())
}

fn apply_access_token(app: &AppHandle, token: String) -> Result<settings::Settings, String> {
    let st = app.state::<App>();
    let _edit = st.settings_edit.lock_unpoisoned();
    let old = st.settings.lock_unpoisoned().clone();
    let mut new_settings = old.clone();
    new_settings.access_token = token;
    new_settings
        .save(&settings_path(app))
        .map_err(|e| e.to_string())?;
    rebuild_changed_api_clients(&st, &old, &new_settings);
    *st.settings.lock_unpoisoned() = new_settings.clone();
    Ok(new_settings)
}

fn reregister_changed_hotkeys(app: &AppHandle, old: &settings::Settings, new: &settings::Settings) {
    if main_window(app).is_none() {
        return;
    }
    if old.hotkeys != new.hotkeys {
        crate::window::unregister_main_window_hotkeys_for(app, old);
        crate::window::register_main_window_hotkeys(app, new);
    }
}

fn rebuild_changed_api_clients(st: &App, old: &settings::Settings, new: &settings::Settings) {
    if stt_client_needs_rebuild(old, new) {
        let rebuilt = build_stt_client(new);
        *st.stt.lock_unpoisoned() = Arc::clone(&rebuilt);
        tauri::async_runtime::spawn(async move { rebuilt.warm_up().await });
    }
    if llm_client_needs_rebuild(old, new) {
        *st.llm.lock_unpoisoned() = build_llm_client(new, Arc::clone(&st.models));
    }
}

/// Всё, из чего собирается STT-клиент: доступ (токен, ключи), вендор, язык, перевод.
fn stt_client_needs_rebuild(old: &settings::Settings, new: &settings::Settings) -> bool {
    old.access_token != new.access_token
        || stt_credentials_changed(old, new)
        || old.stt_provider != new.stt_provider
        || old.stt_language != new.stt_language
        || old.stt_translate != new.stt_translate
}

fn llm_client_needs_rebuild(old: &settings::Settings, new: &settings::Settings) -> bool {
    old.access_token != new.access_token || llm_credentials_changed(old, new)
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
    if let Some(c) = app.state::<App>().capture.lock_unpoisoned().as_ref() {
        c.set_buffer_capacity_secs(new.buffer_seconds.into());
        c.set_buffering(new.buffer_enabled);
    }
}

#[cfg(test)]
mod tests;
