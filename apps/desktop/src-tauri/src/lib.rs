pub mod access;
pub mod app_state;
pub mod audio;
pub mod bindings;
pub mod capture;
pub mod chat;
pub mod chats;
pub mod clipboard;
pub mod context_import;
pub mod error;
pub mod events;
pub mod global_shortcuts;
pub mod hotkeys;
pub mod llm;
pub mod platform;
pub mod permissions;
pub mod preferences;
pub mod preview_protocol;
pub mod recording;
pub mod remote_presets;
pub mod screenshot;
pub mod settings;
pub mod state;
pub mod storage;
pub mod stt;
pub mod sync;
pub mod system;
pub mod tls;
pub mod update;
pub mod window;
pub mod window_geom;

use crate::sync::LockUnpoisoned;
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager};

use crate::app_state::App;

const PREVIEW_URI_SCHEME: &str = "preview";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let specta_builder = bindings::builder();
    tauri::Builder::default()
        .device_event_filter(tauri::DeviceEventFilter::Always)
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .register_uri_scheme_protocol(PREVIEW_URI_SCHEME, |ctx, _request| {
            let html = ctx
                .app_handle()
                .state::<App>()
                .preview_html
                .lock_unpoisoned()
                .clone();
            preview_protocol::preview_response(&html)
        })
        .setup(|app| {
            setup_app(app.handle());
            Ok(())
        })
        .invoke_handler(specta_builder.invoke_handler())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn setup_app(handle: &AppHandle) {
    // Провайдер rustls нужен до первого TLS-клиента, а их здесь строит и
    // апдейтер (свой reqwest внутри плагина), который через `tls` не ходит.
    tls::ensure_crypto_provider();
    preferences::load_dotenv_files();
    let settings = preferences::load_settings_with_env_key_fallback(handle);
    let official_presets = remote_presets::load_initial(handle);
    let models: llm::ModelCatalog = Arc::new(Mutex::new(llm::fallback_models()));
    let stt = app_state::build_stt_client(&settings);
    let llm = app_state::build_llm_client(&settings, Arc::clone(&models));
    spawn_startup_warm_up_and_model_fetch(Arc::clone(&stt), Arc::clone(&llm));
    handle.manage(app_state::build_app_state(
        settings,
        official_presets,
        None,
        stt,
        llm,
        models,
    ));
    if let Err(e) = window::create_launcher_window(handle, &app_state::current_settings(handle)) {
        eprintln!("не удалось создать окно лаунчера: {e}");
    }
    recording::install_ptt_worker(handle);
    recording::install_default_output_device_listener(handle);
    platform::install_move_keys_monitor(handle.clone());
    platform::disable_cursor_autohide_on_typing();
    update::spawn_auto_check(handle.clone());
    remote_presets::spawn_refresh(handle.clone());
}

fn spawn_startup_warm_up_and_model_fetch(
    stt: Arc<dyn stt::SttEngine>,
    llm: Arc<dyn llm::LlmProvider>,
) {
    tauri::async_runtime::spawn(async move {
        let _ = tokio::join!(stt.warm_up(), llm.list_models());
    });
}
