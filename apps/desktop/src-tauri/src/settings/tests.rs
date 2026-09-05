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
fn source_devices_are_saved_independently_without_replacing_the_legacy_choice() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    std::fs::write(&path, r#"{"capture_device_uid":"chosen-output"}"#).unwrap();
    let mut settings = Settings::load(&path).unwrap();
    assert_eq!(settings.capture_device_uid, "chosen-output");
    assert!(settings.microphone_device_uid.is_empty());
    settings.microphone_device_uid = "chosen-microphone".into();
    settings.capture_microphone = true;
    settings.save(&path).unwrap();
    let loaded = Settings::load(&path).unwrap();
    assert_eq!(loaded.capture_device_uid, "chosen-output");
    assert_eq!(loaded.microphone_device_uid, "chosen-microphone");
    assert!(loaded.capture_microphone);
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
    assert!(
        s.quick_actions.is_empty(),
        "удалённые пользователем действия не возвращаются сидами"
    );
}

#[test]
fn clamp_limits_quick_actions_to_the_digit_row() {
    let mut s = Settings {
        quick_actions: (0..QUICK_ACTION_LIMIT + 3).map(test_quick_action).collect(),
        ..Default::default()
    };
    s.clamp();
    assert_eq!(s.quick_actions.len(), QUICK_ACTION_LIMIT);
    assert_eq!(
        s.quick_actions.last().unwrap(),
        &test_quick_action(QUICK_ACTION_LIMIT - 1)
    );
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
    let mut s = Settings {
        buffer_seconds: 0,
        ..Default::default()
    };
    s.clamp();
    assert_eq!(s.buffer_seconds, 1);
    s.buffer_seconds = 120;
    s.clamp();
    assert_eq!(s.buffer_seconds, 10);
}

#[test]
fn clamp_limits_teleprompter_speed_and_font() {
    let mut s = Settings {
        teleprompter_speed: 5.0,
        teleprompter_font_size: 4.0,
        ..Default::default()
    };
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
    let mut s = Settings {
        chat_font_size: 5.0,
        ..Default::default()
    };
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
    let mut s = Settings {
        window_width: 100.0,
        window_height: 100.0,
        ..Default::default()
    };
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
    assert_eq!(s.ui_language, "");
    assert_eq!(s.scroll_step, 120);
}

#[test]
fn clamp_limits_scroll_step() {
    let mut s = Settings {
        scroll_step: 1,
        ..Default::default()
    };
    s.clamp();
    assert_eq!(s.scroll_step, 10);
    s.scroll_step = 100_000;
    s.clamp();
    assert_eq!(s.scroll_step, 1000);
}

#[test]
fn clamp_limits_resize_step() {
    let mut s = Settings {
        resize_step: 1000,
        ..Default::default()
    };
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
            HotkeyBinding {
                action: ACTION_TOGGLE_WINDOW.into(),
                combo: "Cmd+Shift+X".into(),
            },
            HotkeyBinding {
                action: ACTION_RECORD.into(),
                combo: "Cmd+Shift+X".into(),
            },
        ],
        ..Default::default()
    };
    s.clamp();
    assert_eq!(
        crate::hotkeys::effective(&s.hotkeys, ACTION_RECORD),
        "Cmd+Shift+X"
    );
    assert_eq!(
        crate::hotkeys::effective(&s.hotkeys, ACTION_TOGGLE_WINDOW),
        ""
    );
}

#[test]
fn clamp_resets_unknown_ui_language_to_system() {
    let mut s = Settings {
        ui_language: "de".into(),
        ..Default::default()
    };
    s.clamp();
    assert_eq!(s.ui_language, UI_LANGUAGE_SYSTEM);
    for language in UI_LANGUAGES {
        s.ui_language = (*language).into();
        s.clamp();
        assert_eq!(s.ui_language, *language);
    }
}

#[test]
fn clamp_resets_unknown_theme() {
    let mut s = Settings {
        theme: "neon".into(),
        ..Default::default()
    };
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
    assert!(s.openrouter_api_key.is_empty());
    assert_eq!(s.openrouter_stt_model, crate::stt::registry::DEFAULT_OPENROUTER_MODEL);
}

#[test]
fn clamp_resets_unknown_stt_provider() {
    let mut s = Settings {
        stt_provider: "elevenlabs".into(),
        ..Default::default()
    };
    s.clamp();
    assert_eq!(s.stt_provider, STT_PROVIDER_GROQ);
    s.stt_provider = STT_PROVIDER_OPENAI.into();
    s.clamp();
    assert_eq!(s.stt_provider, STT_PROVIDER_OPENAI);
}

fn env_of<'a>(values: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
    move |key_id| {
        values
            .iter()
            .find(|(id, _)| *id == key_id)
            .map(|(_, v)| (*v).to_string())
    }
}

#[test]
fn env_fallback_fills_only_empty_keys() {
    let mut s = Settings::default();
    s.apply_key_fallback(env_of(&[
        (API_KEY_ANTHROPIC, "env-ant"),
        (API_KEY_GROQ, "env-groq"),
        (API_KEY_OPENAI, "env-oai"),
    ]));
    assert_eq!(s.anthropic_api_key, "env-ant");
    assert_eq!(s.groq_api_key, "env-groq");
    assert_eq!(s.openai_api_key, "env-oai");
}

#[test]
fn env_fallback_covers_every_registry_key() {
    let mut s = Settings::default();
    s.apply_key_fallback(|key_id| Some(format!("env-{key_id}")));
    for (key_id, _) in registry_key_ids() {
        assert_eq!(
            api_key_for(&s, key_id),
            format!("env-{key_id}"),
            "key_id {key_id} из реестра не заполнился — нет ветки в api_key_mut"
        );
    }
}

#[test]
fn env_fallback_under_an_access_token_follows_the_registries() {
    // Ключ вендора, которого relay проксирует, под кодом доступа не берётся:
    // код его и так глушит. Ключ вендора без роута на relay берётся всегда —
    // иначе код запирал бы его у того, кто ключ как раз положил.
    let mut s = Settings {
        access_token: "itk_x".into(),
        ..Default::default()
    };
    s.apply_key_fallback(|key_id| Some(format!("env-{key_id}")));
    let ids = registry_key_ids();
    assert!(
        ids.iter().any(|(_, proxied)| *proxied),
        "в реестрах нет ни одного проксируемого ключа"
    );
    assert!(
        ids.iter().any(|(_, proxied)| !*proxied),
        "в реестрах нет ни одного непроксируемого ключа"
    );
    for (key_id, proxied_everywhere) in ids {
        let value = api_key_for(&s, key_id);
        if proxied_everywhere {
            assert_eq!(
                value, "",
                "{key_id}: проксируемый вендор под кодом ключ из окружения не берёт"
            );
        } else {
            assert_eq!(
                value,
                format!("env-{key_id}"),
                "{key_id}: непроксируемый вендор берёт ключ и под кодом"
            );
        }
    }
}

#[test]
fn registry_key_ids_are_unique_and_a_shared_key_is_proxied_only_if_every_row_is() {
    let ids = registry_key_ids();
    let mut seen: Vec<&str> = Vec::new();
    for (key_id, proxied_everywhere) in &ids {
        assert!(!seen.contains(key_id), "key_id {key_id} встречается дважды");
        seen.push(key_id);
        let rows_proxied = crate::llm::registry::PROVIDERS
            .iter()
            .filter(|p| p.key_id == *key_id)
            .map(|p| p.proxied)
            .chain(
                crate::stt::registry::PROVIDERS
                    .iter()
                    .filter(|p| p.key_id == *key_id)
                    .map(|p| p.proxied),
            )
            .all(|proxied| proxied);
        assert_eq!(*proxied_everywhere, rows_proxied, "{key_id}");
    }
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
    let mut s = Settings {
        anthropic_api_key: "saved".into(),
        ..Default::default()
    };
    s.apply_key_fallback(env_of(&[
        (API_KEY_ANTHROPIC, "env-ant"),
        (API_KEY_GROQ, "env-groq"),
        (API_KEY_OPENAI, "env-oai"),
    ]));
    assert_eq!(s.anthropic_api_key, "saved");
    assert_eq!(s.groq_api_key, "env-groq");
    assert_eq!(s.openai_api_key, "env-oai");
}

#[test]
fn env_fallback_ignores_none_and_blank() {
    let mut s = Settings::default();
    s.apply_key_fallback(env_of(&[(API_KEY_GROQ, "   ")]));
    assert_eq!(s.anthropic_api_key, "");
    assert_eq!(s.groq_api_key, "");
    assert_eq!(s.openai_api_key, "");
}

#[test]
fn debug_output_hides_secrets_but_names_the_fields() {
    let s = Settings {
        anthropic_api_key: "sk-ant-secret".into(),
        deepgram_api_key: "dg-secret".into(),
        openrouter_api_key: "sk-or-secret".into(),
        access_token: "itk_secret".into(),
        ..Default::default()
    };
    let printed = format!("{s:?}");
    for secret in ["sk-ant-secret", "dg-secret", "sk-or-secret", "itk_secret"] {
        assert!(
            !printed.contains(secret),
            "{secret} утёк в Debug: {printed}"
        );
    }
    assert!(printed.contains("anthropic_api_key"));
    assert!(printed.contains("access_token"));
}

#[test]
fn load_quarantines_a_corrupt_file_instead_of_silently_defaulting() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    std::fs::write(
        &path,
        r#"{"auto_send": "not a bool", "anthropic_api_key": "keep-me"#,
    )
    .unwrap();

    let s = Settings::load_or_quarantine(&path);

    assert_eq!(s.anthropic_api_key, "", "битый файл даёт дефолты");
    assert!(
        !path.exists(),
        "битый файл обязан уйти с места, иначе автосейв его затрёт"
    );
    let quarantined: Vec<_> = std::fs::read_dir(dir.path())
        .unwrap()
        .filter_map(Result::ok)
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|name| name.starts_with(&format!("settings.json.{QUARANTINE_SUFFIX}-")))
        .collect();
    assert_eq!(
        quarantined.len(),
        1,
        "рядом должна лежать ровно одна копия: {quarantined:?}"
    );
    let kept = std::fs::read_to_string(dir.path().join(&quarantined[0])).unwrap();
    assert!(
        kept.contains("keep-me"),
        "содержимое карантина — исходный файл байт в байт"
    );
}

#[test]
fn load_or_quarantine_leaves_a_missing_file_alone() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    let s = Settings::load_or_quarantine(&path);
    assert_eq!(s.window_width, limits::window::WIDTH.default);
    assert_eq!(
        std::fs::read_dir(dir.path()).unwrap().count(),
        0,
        "карантину нечего откладывать"
    );
}

#[test]
fn load_tolerates_a_malformed_hotkey_binding() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("s.json");
    std::fs::write(
        &path,
        r#"{"anthropic_api_key":"k","hotkeys":[{"action":"record","combo":"F8"},5,{"action":"x"},{"combo":"F1"}]}"#,
    )
    .unwrap();
    let s = Settings::load(&path).expect("одна битая запись не валит весь файл");
    assert_eq!(s.anthropic_api_key, "k");
    assert_eq!(
        crate::hotkeys::effective(&s.hotkeys, crate::hotkeys::ACTION_RECORD),
        "F8"
    );
}

#[test]
fn clamp_limits_opacity_and_step() {
    let mut s = Settings {
        window_opacity: 0.05,
        move_step: 1000,
        ..Default::default()
    };
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
        openrouter_api_key: "sk-or-test".into(),
        openrouter_stt_model: "vendor/custom-stt-model".into(),
        stt_provider: crate::stt::registry::PROVIDER_OPENROUTER.into(),
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
    assert_eq!(loaded.openrouter_api_key, "sk-or-test");
    assert_eq!(loaded.openrouter_stt_model, "vendor/custom-stt-model");
    assert_eq!(loaded.stt_provider, crate::stt::registry::PROVIDER_OPENROUTER);
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
    assert_eq!(
        crate::hotkeys::effective(&s.hotkeys, crate::hotkeys::ACTION_RECORD),
        "Cmd+Shift+X"
    );
    assert_eq!(
        crate::hotkeys::effective(&s.hotkeys, crate::hotkeys::ACTION_SCROLL_CHAT),
        "Cmd"
    );
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
    PromptPreset {
        id: "p1".into(),
        name: "Тест".into(),
        text: "текст".into(),
    }
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
    let b = Bounds {
        default: 5.0,
        min: 1.0,
        max: 10.0,
    };
    assert_eq!(b.clamp(7.0), 7.0);
    assert_eq!(b.clamp(0.5), 1.0);
    assert_eq!(b.clamp(99.0), 10.0);
}

#[test]
fn bounds_clamp_falls_back_to_default_on_non_finite() {
    let b = Bounds {
        default: 5.0,
        min: 1.0,
        max: 10.0,
    };
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
        assert!(
            b.min <= b.default && b.default <= b.max,
            "нарушен диапазон: {b:?}"
        );
    }
    let checked_u32 = [
        limits::window::MOVE_STEP,
        limits::window::RESIZE_STEP,
        limits::chat::SCROLL_STEP,
        limits::capture::BUFFER_SECONDS,
    ];
    for b in checked_u32 {
        assert!(
            b.min <= b.default && b.default <= b.max,
            "нарушен диапазон: {b:?}"
        );
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

#[test]
fn concurrent_saves_publish_whole_files_and_leave_no_temporary_files() {
    use std::sync::{Arc, Barrier};
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("shared.json");
    let payloads: Vec<String> = (0..8)
        .map(|i| format!("{i}:{}", "x".repeat(128 * 1024)))
        .collect();
    let barrier = Arc::new(Barrier::new(payloads.len()));
    std::thread::scope(|scope| {
        for payload in &payloads {
            let barrier = Arc::clone(&barrier);
            let path = &path;
            scope.spawn(move || {
                barrier.wait();
                for _ in 0..8 {
                    write_atomic_owner_only(path, payload).unwrap();
                    let observed = std::fs::read_to_string(path).unwrap();
                    assert_eq!(observed.len(), payload.len());
                    assert!(observed.ends_with(&"x".repeat(128 * 1024)));
                }
            });
        }
    });
    assert!(payloads.contains(&std::fs::read_to_string(&path).unwrap()));
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
}

#[test]
fn failed_atomic_replace_cleans_up_its_temporary_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("destination");
    std::fs::create_dir(&path).unwrap();
    assert!(write_atomic_owner_only(&path, "cannot replace a directory").is_err());
    assert!(path.is_dir());
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
}

#[test]
fn atomic_save_does_not_touch_a_preexisting_shared_temporary_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    let legacy_tmp = path.with_extension("tmp");
    std::fs::write(&legacy_tmp, "belongs to another writer").unwrap();
    write_atomic_owner_only(&path, "new settings").unwrap();
    assert_eq!(
        std::fs::read_to_string(legacy_tmp).unwrap(),
        "belongs to another writer"
    );
}

#[test]
fn old_settings_keep_system_audio_and_do_not_enable_the_microphone() {
    let settings: Settings = serde_json::from_str("{}").unwrap();
    assert!(settings.capture_system_audio);
    assert!(!settings.capture_microphone);
}

#[test]
fn source_switches_are_independent_and_survive_persistence() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    for (system, microphone) in [(true, false), (true, true), (false, true), (false, false)] {
        let mut settings = Settings {
            capture_system_audio: system,
            capture_microphone: microphone,
            ..Default::default()
        };
        settings.clamp();
        settings.save(&path).unwrap();
        let loaded = Settings::load(&path).unwrap();
        assert_eq!(
            (loaded.capture_system_audio, loaded.capture_microphone),
            (system, microphone)
        );
    }
}

#[test]
fn openrouter_model_clamp_defaults_only_blank_ids_and_preserves_dynamic_choices() {
    let mut settings = Settings {
        openrouter_stt_model: "   ".into(),
        ..Default::default()
    };
    settings.clamp();
    assert_eq!(settings.openrouter_stt_model, crate::stt::registry::DEFAULT_OPENROUTER_MODEL);
    settings.openrouter_stt_model = " vendor/new-model ".into();
    settings.clamp();
    assert_eq!(settings.openrouter_stt_model, "vendor/new-model");
}
