use tauri::{AppHandle, Manager};

use crate::app_state::{settings_path, App};
use crate::{identity, platform, update};

#[tauri::command]
#[specta::specta]
pub fn open_audio_permission_settings() {
    platform::open_audio_capture_privacy_pane();
}

#[tauri::command]
#[specta::specta]
pub fn screen_capture_available() -> bool {
    platform::screen_capture_access()
}

#[tauri::command]
#[specta::specta]
pub fn request_screen_capture_permission() -> bool {
    platform::request_screen_capture_access()
}

#[tauri::command]
#[specta::specta]
pub fn open_screen_capture_settings() {
    platform::open_screen_capture_privacy_pane();
}

#[tauri::command]
#[specta::specta]
pub fn open_external(url: String) {
    platform::open_web_url(&url);
}

#[tauri::command]
#[specta::specta]
pub fn set_preview_html(app: AppHandle, html: String) {
    *app.state::<App>().preview_html.lock().unwrap() = html;
}

#[tauri::command]
#[specta::specta]
pub async fn check_for_update(app: AppHandle) -> Result<Option<update::UpdateInfo>, String> {
    update::check(&app).await
}

#[tauri::command]
#[specta::specta]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    update::install(app).await
}

#[tauri::command]
#[specta::specta]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").into()
}

#[tauri::command]
#[specta::specta]
pub fn list_identities() -> Vec<identity::IdentityInfo> {
    identity::list()
}

#[tauri::command]
#[specta::specta]
pub async fn set_app_identity(app: AppHandle, identity_id: String) -> Result<(), String> {
    if !identity::is_known_id(&identity_id) {
        return Err(format!("Неизвестный облик: {identity_id}"));
    }
    let state = app.state::<App>();
    let already_active = state.settings.lock().unwrap().identity_id == identity_id;
    if already_active {
        return Ok(());
    }
    let new_exe_path = identity::prepare(&identity_id).await?;
    {
        let mut settings = state.settings.lock().unwrap();
        settings.identity_id = identity_id.clone();
        settings
            .save(&settings_path(&app))
            .map_err(|e| e.to_string())?;
    }
    identity::relaunch(&app, new_exe_path, identity::PRE_RELAUNCH_RENDER_DELAY).await
}
