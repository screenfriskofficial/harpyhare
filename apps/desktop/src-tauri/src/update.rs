use crate::sync::LockUnpoisoned;
use serde::Serialize;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::UpdaterExt;

use crate::events;

const ENDPOINT_OVERRIDE_ENV: &str = "ITECH_UPDATE_ENDPOINT";
const LOG_TAG: &str = "[update]";
const AUTO_CHECK_INITIAL_DELAY: Duration = Duration::from_secs(5);
const AUTO_CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
const PRE_RESTART_RENDER_DELAY: Duration = Duration::from_millis(300);
const PERCENT_SCALE: u64 = 100;
const BYTES_PER_MIB: u64 = 1024 * 1024;

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub notes: String,
    pub date: Option<String>,
}

pub async fn check(app: &AppHandle) -> Result<Option<UpdateInfo>, String> {
    let updater = build_updater(app)?;
    let update = updater.check().await.map_err(|e| e.to_string())?;
    let info = update.as_ref().map(update_info);
    if let Some(i) = &info {
        eprintln!("{LOG_TAG} найдена версия {}", i.version);
    }
    *app.state::<crate::app_state::App>().pending_update.lock_unpoisoned() = update;
    Ok(info)
}

fn build_updater(app: &AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    let mut builder = app.updater_builder();
    if let Ok(endpoint) = std::env::var(ENDPOINT_OVERRIDE_ENV) {
        let url = endpoint
            .parse()
            .map_err(|e| format!("{ENDPOINT_OVERRIDE_ENV}: {e}"))?;
        builder = builder.endpoints(vec![url]).map_err(|e| e.to_string())?;
    }
    builder.build().map_err(|e| e.to_string())
}

fn update_info(update: &tauri_plugin_updater::Update) -> UpdateInfo {
    UpdateInfo {
        version: update.version.clone(),
        notes: update.body.clone().unwrap_or_default(),
        date: update.date.map(|d| d.to_string()),
    }
}

pub async fn install(app: AppHandle) -> Result<(), String> {
    let update = claim_pending_update(&app)?;
    let version = update.version.clone();
    let result = update
        .download_and_install(throttled_progress_emitter(app.clone()), || {})
        .await;
    match result {
        Ok(()) => {
            events::update_done(&app, version);
            tokio::time::sleep(PRE_RESTART_RENDER_DELAY).await;
            app.restart()
        }
        Err(e) => {
            release_install_lock(&app);
            Err(e.to_string())
        }
    }
}

/// Найденное обновление КЛОНИРУЕТСЯ, а не забирается: после неудачной
/// установки повторная попытка раньше отвечала «сначала проверьте новую
/// версию», хотя фронт всё ещё показывал найденную.
fn claim_pending_update(app: &AppHandle) -> Result<tauri_plugin_updater::Update, String> {
    let st = app.state::<crate::app_state::App>();
    if st.update_installing.swap(true, Ordering::SeqCst) {
        return Err("Обновление уже устанавливается".into());
    }
    let Some(update) = st.pending_update.lock_unpoisoned().clone() else {
        st.update_installing.store(false, Ordering::SeqCst);
        return Err("Обновление не найдено — сначала проверьте новую версию".into());
    };
    Ok(update)
}

fn release_install_lock(app: &AppHandle) {
    app.state::<crate::app_state::App>()
        .update_installing
        .store(false, Ordering::SeqCst);
}

fn throttled_progress_emitter(app: AppHandle) -> impl FnMut(usize, Option<u64>) {
    let mut downloaded: u64 = 0;
    let mut last_mark: u64 = 0;
    move |chunk, total| {
        downloaded += chunk as u64;
        if let Some(mark) = progress_step(downloaded, total, last_mark) {
            last_mark = mark;
            events::update_progress(&app, downloaded, total);
        }
    }
}

pub fn spawn_auto_check(app: AppHandle) {
    if auto_check_disabled_in_this_build() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(AUTO_CHECK_INITIAL_DELAY).await;
        loop {
            notify_if_update_found(&app).await;
            tokio::time::sleep(AUTO_CHECK_INTERVAL).await;
        }
    });
}

fn auto_check_disabled_in_this_build() -> bool {
    cfg!(debug_assertions) && std::env::var(ENDPOINT_OVERRIDE_ENV).is_err()
}

async fn notify_if_update_found(app: &AppHandle) {
    match check(app).await {
        Ok(Some(info)) => {
            if should_notify(&info.version, &skipped_version(app)) {
                events::update_available(app, info);
            }
        }
        Ok(None) => {}
        Err(e) => eprintln!("{LOG_TAG} автопроверка не удалась: {e}"),
    }
}

fn skipped_version(app: &AppHandle) -> String {
    app.state::<crate::app_state::App>()
        .settings
        .lock_unpoisoned()
        .skipped_version
        .clone()
}

pub fn should_notify(found_version: &str, skipped_version: &str) -> bool {
    found_version != skipped_version
}

pub fn progress_step(downloaded: u64, total: Option<u64>, last_mark: u64) -> Option<u64> {
    let mark = match total {
        Some(t) if t > 0 => downloaded * PERCENT_SCALE / t,
        _ => downloaded / BYTES_PER_MIB,
    };
    (mark != last_mark).then_some(mark)
}

#[cfg(test)]
mod tests;
