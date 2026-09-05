use base64::Engine;
use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;

const DECODE_ERROR: &str = "Не удалось разобрать картинку для буфера обмена";
const WRITE_ERROR: &str = "Не удалось положить картинку в буфер обмена";

pub fn write_image(app: &AppHandle, image: &tauri::image::Image<'_>) {
    let _ = app.clipboard().write_image(image);
}

#[tauri::command]
#[specta::specta]
pub fn copy_image_to_clipboard(app: AppHandle, data_base64: String) -> Result<(), String> {
    let png = base64::engine::general_purpose::STANDARD
        .decode(data_base64)
        .map_err(|_| DECODE_ERROR.to_string())?;
    let image = tauri::image::Image::from_bytes(&png).map_err(|_| DECODE_ERROR.to_string())?;
    app.clipboard()
        .write_image(&image)
        .map_err(|_| WRITE_ERROR.to_string())
}
