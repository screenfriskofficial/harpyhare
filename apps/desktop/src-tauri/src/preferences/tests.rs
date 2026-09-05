use super::*;

fn with_key(base: &settings::Settings, key_id: &str, value: &str) -> settings::Settings {
    let mut json = serde_json::to_value(base).expect("настройки сериализуются");
    let field = format!("{key_id}_api_key");
    assert!(
        json.get(&field).is_some(),
        "key_id {key_id} не указывает ни на одно поле настроек ({field})"
    );
    json[&field] = serde_json::Value::String(value.into());
    serde_json::from_value(json).expect("настройки десериализуются обратно")
}

#[test]
fn every_speech_vendor_key_triggers_a_client_rebuild() {
    let blank = settings::Settings::default();
    for spec in crate::stt::registry::PROVIDERS {
        let edited = with_key(&blank, spec.key_id, "новый");
        assert!(
            stt_credentials_changed(&blank, &edited),
            "правка ключа {} вендора {} обязана пересобрать STT-клиент",
            spec.key_id,
            spec.id
        );
    }
}

#[test]
fn every_answer_vendor_key_triggers_a_client_rebuild() {
    let blank = settings::Settings::default();
    for spec in crate::llm::registry::PROVIDERS {
        let edited = with_key(&blank, spec.key_id, "новый");
        assert!(
            llm_credentials_changed(&blank, &edited),
            "правка ключа {} вендора {} обязана пересобрать LLM-клиент",
            spec.key_id,
            spec.id
        );
    }
}

#[test]
fn untouched_settings_rebuild_nothing() {
    let s = with_key(&settings::Settings::default(), "groq", "g");
    assert!(!stt_credentials_changed(&s, &s));
    assert!(!llm_credentials_changed(&s, &s));
}

/// Матрица «какое поле изменилось → какой клиент пересобрать», без Tauri.
#[test]
fn every_field_the_stt_client_is_built_from_triggers_its_rebuild() {
    let base = settings::Settings::default();
    let edits: Vec<(&str, settings::Settings)> = vec![
        (
            "stt_provider",
            settings::Settings {
                stt_provider: crate::stt::registry::PROVIDER_OPENAI.into(),
                ..base.clone()
            },
        ),
        (
            "stt_language",
            settings::Settings {
                stt_language: "en".into(),
                ..base.clone()
            },
        ),
        (
            "openrouter_stt_model",
            settings::Settings {
                openrouter_stt_model: "vendor/new-transcription-model".into(),
                ..base.clone()
            },
        ),
        (
            "stt_translate",
            settings::Settings {
                stt_translate: true,
                ..base.clone()
            },
        ),
        (
            "access_token",
            settings::Settings {
                access_token: "itk_x".into(),
                ..base.clone()
            },
        ),
        ("groq_api_key", with_key(&base, "groq", "k")),
    ];
    for (field, edited) in edits {
        assert!(
            stt_client_needs_rebuild(&base, &edited),
            "смена {field} обязана пересобрать STT-клиент"
        );
    }
    let unrelated = settings::Settings {
        auto_send: true,
        window_width: 999.0,
        ..base.clone()
    };
    assert!(
        !stt_client_needs_rebuild(&base, &unrelated),
        "чужие поля клиент не трогают"
    );
}

#[test]
fn the_llm_client_follows_the_token_and_the_answer_keys_only() {
    let base = settings::Settings::default();
    assert!(llm_client_needs_rebuild(
        &base,
        &settings::Settings {
            access_token: "itk_x".into(),
            ..base.clone()
        }
    ));
    assert!(llm_client_needs_rebuild(
        &base,
        &with_key(&base, "anthropic", "k")
    ));
    assert!(!llm_client_needs_rebuild(
        &base,
        &settings::Settings {
            stt_language: "en".into(),
            ..base.clone()
        }
    ));
}
