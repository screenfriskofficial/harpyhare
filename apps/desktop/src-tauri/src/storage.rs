use std::time::Duration;

use tauri::AppHandle;

use crate::app_state::{chats_path, context_library_path};
use crate::{chats, context_import};

/// Патологический PDF может занять blocking-поток надолго; команда отвечает
/// ошибкой по дедлайну, а не ждёт его вместе с пользователем.
const IMPORT_PARSE_TIMEOUT: Duration = Duration::from_secs(60);
const ERR_IMPORT_TIMEOUT: &str = "Разбор файла занял слишком много времени";

async fn with_parse_deadline(
    task: tokio::task::JoinHandle<Result<String, String>>,
) -> Result<String, String> {
    match tokio::time::timeout(IMPORT_PARSE_TIMEOUT, task).await {
        Ok(joined) => joined.map_err(|e| e.to_string())?,
        Err(_) => Err(ERR_IMPORT_TIMEOUT.to_string()),
    }
}

#[tauri::command]
#[specta::specta]
pub fn load_chats(app: AppHandle) -> Result<String, String> {
    chats::load(&chats_path(&app)).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn save_chats(app: AppHandle, json: String) -> Result<(), String> {
    chats::save(&chats_path(&app), &json).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn load_context_library(app: AppHandle) -> Result<String, String> {
    chats::load(&context_library_path(&app)).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn save_context_library(app: AppHandle, json: String) -> Result<(), String> {
    chats::save(&context_library_path(&app), &json).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn read_context_import_file(path: String) -> Result<String, String> {
    with_parse_deadline(tokio::task::spawn_blocking(move || {
        context_import::read_import_file(std::path::Path::new(&path))
    }))
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn read_context_pdf_bytes(data_base64: String) -> Result<String, String> {
    with_parse_deadline(tokio::task::spawn_blocking(move || {
        context_import::read_pdf_base64(&data_base64)
    }))
    .await
}
