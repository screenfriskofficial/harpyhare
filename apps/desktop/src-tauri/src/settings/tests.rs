use super::*;

#[test]
fn defaults_match_spec() {
    let s = Settings::default();
    assert!(s.hotkeys.is_empty());
    assert!(!s.auto_send);
    assert_eq!(s.window_opacity, 0.9);
    assert_eq!(s.move_step, 20);
    assert!(s.prompt_presets.is_empty());
    assert!(s.auto_preview_html);
    assert_eq!(s.chat_font_size, 13.5);
    assert_eq!(s.stt_language, "ru");
    assert!(!s.stt_translate);
    assert!(!s.screen_share_visible);
    assert_eq!(s.teleprompter_speed, 40.0);
    assert_eq!(s.teleprompter_font_size, 28.0);
    assert!(s.teleprompter_resume);
    assert_eq!(s.window_width, 960.0);
    assert_eq!(s.window_height, 680.0);
    assert_eq!(s.resize_step, 20);
    assert_eq!(s.capture_device_uid, "");
    assert_eq!(s.microphone_device_uid, "");
    assert!(s.buffer_enabled);
    assert_eq!(s.buffer_seconds, 4);
}

#[test]
fn microphone_selection_survives_save_and_reset_without_changing_output() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    let mut s = Settings {
        capture_device_uid: "speakers-uid".into(),
        microphone_device_uid: "usb-microphone-uid".into(),
        ..Default::default()
    };
    s.save(&path).unwrap();
    let loaded = Settings::load(&path).unwrap();
    assert_eq!(loaded.capture_device_uid, "speakers-uid");
    assert_eq!(loaded.microphone_device_uid, "usb-microphone-uid");
    s.microphone_device_uid.clear();
    s.save(&path).unwrap();
    let loaded = Settings::load(&path).unwrap();
    assert_eq!(loaded.microphone_device_uid, "");
    assert_eq!(loaded.capture_device_uid, "speakers-uid");
}

#[test]
fn old_settings_default_to_system_microphone() {
    let s: Settings = serde_json::from_str(r#"{"capture_device_uid":"speakers-uid"}"#).unwrap();
    assert_eq!(s.microphone_device_uid, "");
    assert_eq!(s.capture_device_uid, "speakers-uid");
}

#[test]
fn load_missing_quick_actions_gives_the_seeds() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("s.json");
    std::fs::write(&path, r#"{"auto_send":true}"#).unwrap();
    let s = Settings::load(&path).unwrap();
    let ids: Vec<&str> = s.quick_actions.iter().map(|a| a.id.as_str()).collect();
    assert_eq!(ids, vec!["detail", "brief", "code"]);
    assert!(!s.quick_action_attachments);
}

#[test]
fn load_saved_empty_quick_actions_stays_empty() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("s.json");
    std::fs::write(&path, r#"{"quick_actions":[]}"#).unwrap();
    let s = Settings::load(&path).unwrap();
    assert!(s.quick_actions.is_empty(), "удалённые пользователем действия не возвращаются сидами");
}

#[test]
fn clamp_limits_quick_actions_to_the_digit_row() {
    let mut s = Settings {
        quick_actions: (0..QUICK_ACTION_LIMIT + 3).map(test_quick_action).collect(),
        ..Default::default()
    };
    s.clamp();
    assert_eq!(s.quick_actions.len(), QUICK_ACTION_LIMIT);
    assert_eq!(s.quick_actions.last().unwrap(), &test_quick_action(QUICK_ACTION_LIMIT - 1));
}

#[test]
fn load_missing_buffer_fields_default() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("s.json");
    std::fs::write(&path, r#"{"auto_send":true}"#).unwrap();
    let s = Settings::load(&path).unwrap();
    assert!(s.buffer_enabled);
    assert_eq!(s.buffer_seconds, 4);
}

#[test]
fn clamp_limits_buffer_seconds() {
    let mut s = Settings { buffer_seconds: 0, ..Default::default() };
    s.clamp();
    assert_eq!(s.buffer_seconds, 1);
    s.buffer_seconds = 120;
    s.clamp();
    assert_eq!(s.buffer_seconds, 10);
}

#[test]
fn clamp_limits_teleprompter_speed_and_font() {
    let mut s =
        Settings { teleprompter_speed: 5.0, teleprompter_font_size: 4.0, ..Default::default() };
    s.clamp();
    assert_eq!(s.teleprompter_speed, 10.0);
    assert_eq!(s.teleprompter_font_size, 20.0);
    s.teleprompter_speed = 999.0;
    s.teleprompter_font_size = 999.0;
    s.clamp();
    assert_eq!(s.teleprompter_speed, 150.0);
    assert_eq!(s.teleprompter_font_size, 48.0);
    s.teleprompter_speed = f64::NAN;
    s.clamp();
    assert_eq!(s.teleprompter_speed, 40.0);
}

#[test]
fn load_missing_teleprompter_fields_default() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("s.json");
    std::fs::write(&path, r#"{"auto_send":true}"#).unwrap();
    let s = Settings::load(&path).unwrap();
    assert_eq!(s.teleprompter_speed, 40.0);
    assert_eq!(s.teleprompter_font_size, 28.0);
}

#[test]
fn clamp_limits_chat_font_size() {
    let mut s = Settings { chat_font_size: 5.0, ..Default::default() };
    s.clamp();
    assert_eq!(s.chat_font_size, 10.0);
    s.chat_font_size = 99.0;
    s.clamp();
    assert_eq!(s.chat_font_size, 20.0);
    s.chat_font_size = f64::NAN;
    s.clamp();
    assert_eq!(s.chat_font_size, 13.5);
}

#[test]
fn clamp_limits_window_size() {
    let mut s = Settings { window_width: 100.0, window_height: 100.0, ..Default::default() };
    s.clamp();
    assert_eq!(s.window_width, 300.0);
    assert_eq!(s.window_height, 520.0);
    s.window_width = 5000.0;
    s.window_height = 5000.0;
    s.clamp();
    assert_eq!(s.window_width, 1600.0);
    assert_eq!(s.window_height, 1100.0);
    s.window_width = f64::NAN;
    s.window_height = f64::NAN;
    s.clamp();
    assert_eq!(s.window_width, 960.0);
    assert_eq!(s.window_height, 680.0);
}

#[test]
fn load_missing_window_size_defaults() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("s.json");
    std::fs::write(&path, r#"{"auto_send":true}"#).unwrap();
    let s = Settings::load(&path).unwrap();
    assert_eq!(s.window_width, 960.0);
    assert_eq!(s.window_height, 680.0);
    assert_eq!(s.resize_step, 20);
    assert_eq!(s.capture_device_uid, "");
    assert_eq!(s.theme, "gray");
    assert_eq!(s.scroll_step, 120);
}

#[test]
fn clamp_limits_scroll_step() {
    let mut s = Settings { scroll_step: 1, ..Default::default() };
    s.clamp();
    assert_eq!(s.scroll_step, 10);
    s.scroll_step = 100_000;
    s.clamp();
    assert_eq!(s.scroll_step, 1000);
}

#[test]
fn clamp_limits_resize_step() {
    let mut s = Settings { resize_step: 1000, ..Default::default() };
    s.clamp();
    assert_eq!(s.resize_step, 200);
    s.resize_step = 0;
    s.clamp();
    assert_eq!(s.resize_step, 1);
}

#[test]
fn clamp_resolves_hotkey_collisions_in_favour_of_the_latest_binding() {
    use crate::hotkeys::{HotkeyBinding, ACTION_RECORD, ACTION_TOGGLE_WINDOW};
    let mut s = Settings {
        hotkeys: vec![
            HotkeyBinding { action: ACTION_TOGGLE_WINDOW.into(), combo: "Cmd+Shift+X".into() },
            HotkeyBinding { action: ACTION_RECORD.into(), combo: "Cmd+Shift+X".into() },
        ],
        ..Default::default()
    };
    s.clamp();
    assert_eq!(crate::hotkeys::effective(&s.hotkeys, ACTION_RECORD), "Cmd+Shift+X");
    assert_eq!(crate::hotkeys::effective(&s.hotkeys, ACTION_TOGGLE_WINDOW), "");
}

#[test]
fn clamp_resets_unknown_theme() {
    let mut s = Settings { theme: "neon".into(), ..Default::default() };
    s.clamp();
    assert_eq!(s.theme, "gray");
    s.theme = "black".into();
    s.clamp();
    assert_eq!(s.theme, "black");
}

#[test]
fn load_old_model_field_is_ignored() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("s.json");
    std::fs::write(&path, r#"{"model":"claude-haiku-4-5","auto_send":true}"#).unwrap();
    let s = Settings::load(&path).unwrap();
    assert!(s.auto_send);
}

#[test]
fn load_missing_skipped_version_defaults_empty() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("s.json");
    std::fs::write(&path, r#"{"auto_send":true}"#).unwrap();
    let s = Settings::load(&path).unwrap();
    assert_eq!(s.skipped_version, "");
}

#[test]
fn load_missing_stt_and_screen_share_fields_default() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("s.json");
    std::fs::write(&path, r#"{"auto_send":true}"#).unwrap();
    let s = Settings::load(&path).unwrap();
    assert_eq!(s.stt_language, "ru");
    assert!(!s.stt_translate);
    assert!(!s.screen_share_visible);
    assert_eq!(s.stt_provider, STT_PROVIDER_GROQ);
}

#[test]
fn clamp_resets_unknown_stt_provider() {
    let mut s = Settings { stt_provider: "elevenlabs".into(), ..Default::default() };
    s.clamp();
    assert_eq!(s.stt_provider, STT_PROVIDER_GROQ);
    s.stt_provider = STT_PROVIDER_OPENAI.into();
    s.clamp();
    assert_eq!(s.stt_provider, STT_PROVIDER_OPENAI);
}

#[test]
fn env_fallback_fills_only_empty_keys() {
    let mut s = Settings::default();
    s.apply_key_fallback(
        Some("env-ant".into()),
        Some("env-groq".into()),
        Some("env-oai".into()),
        Some("env-xai".into()),
        Some("env-dg".into()),
        Some("env-xclis".into()),
        Some("env-openrouter".into()),
    );
    assert_eq!(s.anthropic_api_key, "env-ant");
    assert_eq!(s.groq_api_key, "env-groq");
    assert_eq!(s.openai_api_key, "env-oai");
    assert_eq!(s.openrouter_api_key, "env-openrouter");
}

#[test]
fn env_fallback_skipped_entirely_when_access_token_set() {
    let mut s = Settings { access_token: "itk_x".into(), ..Default::default() };
    s.apply_key_fallback(
        Some("env-ant".into()),
        Some("env-groq".into()),
        Some("env-oai".into()),
        Some("env-xai".into()),
        Some("env-dg".into()),
        Some("env-xclis".into()),
        Some("env-openrouter".into()),
    );
    assert_eq!(s.anthropic_api_key, "");
    assert_eq!(s.groq_api_key, "");
    assert_eq!(s.openai_api_key, "");
    // Код доступа не даёт доступа к непроксируемым вендорам, поэтому их ключи
    // из окружения он подавлять не должен — иначе Grok и Deepgram оказываются
    // заперты у того, кто ключ как раз положил.
    assert_eq!(s.xai_api_key, "env-xai");
    assert_eq!(s.deepgram_api_key, "env-dg");
    assert_eq!(s.xclis_api_key, "env-xclis");
    assert_eq!(s.openrouter_api_key, "env-openrouter");
}

#[test]
fn load_missing_access_token_defaults_empty() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("s.json");
    std::fs::write(&path, r#"{"auto_send":true}"#).unwrap();
    let s = Settings::load(&path).unwrap();
    assert_eq!(s.access_token, "");
}

#[test]
fn env_fallback_does_not_override_saved_keys() {
    let mut s = Settings { anthropic_api_key: "saved".into(), ..Default::default() };
    s.apply_key_fallback(
        Some("env-ant".into()),
        Some("env-groq".into()),
        Some("env-oai".into()),
        Some("env-xai".into()),
        Some("env-dg".into()),
        Some("env-xclis".into()),
        Some("env-openrouter".into()),
    );
    assert_eq!(s.anthropic_api_key, "saved");
    assert_eq!(s.groq_api_key, "env-groq");
    assert_eq!(s.openai_api_key, "env-oai");
    assert_eq!(s.openrouter_api_key, "env-openrouter");
}

#[test]
fn env_fallback_ignores_none_and_blank() {
    let mut s = Settings::default();
    s.apply_key_fallback(None, Some("   ".into()), None, None, None, None, None);
    assert_eq!(s.anthropic_api_key, "");
    assert_eq!(s.groq_api_key, "");
    assert_eq!(s.openai_api_key, "");
}

#[test]
fn openrouter_key_survives_serialization() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    let settings = Settings {
        openrouter_api_key: "sk-or-test".into(),
        ..Default::default()
    };
    settings.save(&path).unwrap();
    assert_eq!(Settings::load(&path).unwrap().openrouter_api_key, "sk-or-test");
}

#[test]
fn clamp_limits_opacity_and_step() {
    let mut s = Settings { window_opacity: 0.05, move_step: 1000, ..Default::default() };
    s.clamp();
    assert_eq!(s.window_opacity, 0.2);
    assert_eq!(s.move_step, 200);
    s.window_opacity = 1.5;
    s.move_step = 0;
    s.clamp();
    assert_eq!(s.window_opacity, 1.0);
    assert_eq!(s.move_step, 1);
}

#[test]
fn save_load_roundtrip_with_owner_only_perms() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    let s = Settings {
        groq_api_key: "gsk_test".into(),
        chat_font_size: 15.0,
        window_opacity: 0.5,
        auto_send: true,
        auto_preview_html: false,
        prompt_presets: vec![test_preset()],
        ..Default::default()
    };
    s.save(&path).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }
    let loaded = Settings::load(&path).unwrap();
    assert_eq!(loaded.groq_api_key, "gsk_test");
    assert_eq!(loaded.chat_font_size, 15.0);
    assert_eq!(loaded.window_opacity, 0.5);
    assert!(loaded.auto_send);
    assert!(!loaded.auto_preview_html);
    assert_eq!(loaded.prompt_presets.len(), 1);
    assert_eq!(loaded.prompt_presets[0].name, "Тест");
}

#[test]
fn load_missing_auto_preview_html_defaults_true() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("s.json");
    std::fs::write(&path, r#"{"auto_send":true}"#).unwrap();
    let s = Settings::load(&path).unwrap();
    assert!(s.auto_preview_html);
}

#[test]
fn load_migrates_legacy_hotkey_fields_into_bindings() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("s.json");
    std::fs::write(&path, r#"{"hotkey":"Cmd+Shift+X","scroll_modifier":"Cmd"}"#).unwrap();
    let s = Settings::load(&path).unwrap();
    assert_eq!(crate::hotkeys::effective(&s.hotkeys, crate::hotkeys::ACTION_RECORD), "Cmd+Shift+X");
    assert_eq!(crate::hotkeys::effective(&s.hotkeys, crate::hotkeys::ACTION_SCROLL_CHAT), "Cmd");
}

#[test]
fn load_missing_file_gives_defaults() {
    let s = Settings::load(std::path::Path::new("/nonexistent/x.json")).unwrap();
    assert!(s.hotkeys.is_empty());
    assert!(!s.auto_send);
    assert_eq!(s.move_step, 20);
}

#[test]
fn load_clamps_out_of_range_values() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("s.json");
    std::fs::write(&path, r#"{"window_opacity":0.05,"move_step":999}"#).unwrap();
    let s = Settings::load(&path).unwrap();
    assert_eq!(s.window_opacity, 0.2);
    assert_eq!(s.move_step, 200);
}

#[test]
fn save_creates_parent_directories() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("nested/deeper/settings.json");
    Settings::default().save(&path).unwrap();
    assert!(path.exists());
    assert!(!path.with_extension("tmp").exists());
}

fn test_preset() -> PromptPreset {
    PromptPreset { id: "p1".into(), name: "Тест".into(), text: "текст".into() }
}

fn test_quick_action(index: usize) -> QuickAction {
    QuickAction {
        id: format!("q{index}"),
        title: format!("Действие {index}"),
        prompt: format!("Промпт {index}"),
    }
}

#[test]
fn load_missing_prompt_presets_defaults_to_empty() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("s.json");
    std::fs::write(&path, r#"{"auto_send":true}"#).unwrap();
    let s = Settings::load(&path).unwrap();
    assert!(s.prompt_presets.is_empty());
}

#[test]
fn load_old_system_prompt_is_ignored() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("s.json");
    std::fs::write(&path, r#"{"system_prompt":"старое","auto_send":false}"#).unwrap();
    let s = Settings::load(&path).unwrap();
    assert!(s.prompt_presets.is_empty());
}

#[test]
fn bounds_clamp_keeps_value_inside_range() {
    let b = Bounds { default: 5.0, min: 1.0, max: 10.0 };
    assert_eq!(b.clamp(7.0), 7.0);
    assert_eq!(b.clamp(0.5), 1.0);
    assert_eq!(b.clamp(99.0), 10.0);
}

#[test]
fn bounds_clamp_falls_back_to_default_on_non_finite() {
    let b = Bounds { default: 5.0, min: 1.0, max: 10.0 };
    assert_eq!(b.clamp(f64::NAN), 5.0);
    assert_eq!(b.clamp(f64::INFINITY), 5.0);
    assert_eq!(b.clamp(f64::NEG_INFINITY), 5.0);
}

#[test]
fn every_bound_default_sits_inside_its_own_range() {
    let checked_f64 = [
        limits::window::WIDTH,
        limits::window::HEIGHT,
        limits::window::OPACITY,
        limits::chat::FONT_SIZE,
        limits::teleprompter::SPEED,
        limits::teleprompter::FONT_SIZE,
    ];
    for b in checked_f64 {
        assert!(b.min <= b.default && b.default <= b.max, "нарушен диапазон: {b:?}");
    }
    let checked_u32 = [
        limits::window::MOVE_STEP,
        limits::window::RESIZE_STEP,
        limits::chat::SCROLL_STEP,
        limits::capture::BUFFER_SECONDS,
    ];
    for b in checked_u32 {
        assert!(b.min <= b.default && b.default <= b.max, "нарушен диапазон: {b:?}");
    }
}

#[test]
fn defaults_struct_uses_the_registry_values() {
    let s = Settings::default();
    assert_eq!(s.window_width, limits::window::WIDTH.default);
    assert_eq!(s.window_height, limits::window::HEIGHT.default);
    assert_eq!(s.window_opacity, limits::window::OPACITY.default);
    assert_eq!(s.chat_font_size, limits::chat::FONT_SIZE.default);
    assert_eq!(s.scroll_step, limits::chat::SCROLL_STEP.default);
    assert_eq!(s.teleprompter_speed, limits::teleprompter::SPEED.default);
    assert_eq!(s.buffer_seconds, limits::capture::BUFFER_SECONDS.default);
}
