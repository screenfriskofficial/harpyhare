use tauri_specta::{collect_commands, Builder, ErrorHandlingMode};

use crate::settings::{self, SettingsLimits};
use crate::{chat, events, plugins, preferences, recording, storage, system, window};

pub const BINDINGS_OUTPUT_PATH: &str = "../src/ipc/bindings.ts";
const SETTINGS_LIMITS_CONSTANT: &str = "SETTINGS_LIMITS";
const SETTINGS_DEFAULTS_CONSTANT: &str = "SETTINGS_DEFAULTS";
const MODIFIER_COMBOS_CONSTANT: &str = "MODIFIER_COMBOS";

pub fn builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            chat::send_to_claude,
            chat::cancel_stream,
            chat::count_chat_tokens,
            chat::probe_connectivity,
            chat::list_models,
            storage::load_chats,
            storage::save_chats,
            storage::load_context_library,
            storage::save_context_library,
            storage::read_context_import_file,
            storage::read_context_pdf_bytes,
            recording::retry_transcription,
            recording::list_audio_output_devices,
            recording::capture_available,
            recording::request_audio_capture_permission,
            preferences::get_settings,
            preferences::set_settings,
            preferences::get_official_presets,
            preferences::set_ptt_suspended,
            preferences::redeem_access_code,
            window::set_window_size,
            window::close_app,
            window::hide_main_window,
            window::launch_main_window,
            window::stop_main_window,
            system::open_audio_permission_settings,
            system::open_external,
            system::set_preview_html,
            system::check_for_update,
            system::install_update,
            system::get_app_version,
            system::list_identities,
            system::set_app_identity,
            plugins::list_plugins,
        ])
        .typ::<crate::error::AppError>()
        .typ::<crate::state::RecorderState>()
        .typ::<events::LlmDelta>()
        .typ::<events::LlmDone>()
        .typ::<events::LlmUsage>()
        .typ::<events::LlmErrorEvent>()
        .typ::<events::ResizeKeyPayload>()
        .typ::<events::ResizeDim>()
        .typ::<events::UpdateProgress>()
        .typ::<events::UpdateDone>()
        .typ::<plugins::PluginDescriptor>()
        .typ::<plugins::PluginState>()
        .typ::<plugins::PluginCapability>()
        .constant(SETTINGS_LIMITS_CONSTANT, SettingsLimits::current())
        .constant(SETTINGS_DEFAULTS_CONSTANT, settings::Settings::default())
        .constant(MODIFIER_COMBOS_CONSTANT, settings::MODIFIER_COMBOS)
        .error_handling(ErrorHandlingMode::Throw)
}

#[cfg(test)]
mod tests;
