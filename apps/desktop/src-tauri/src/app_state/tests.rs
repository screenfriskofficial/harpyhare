use super::*;

const ANTHROPIC_KEY: &str = "anthropic-key";
const OPENAI_KEY: &str = "openai-key";
const DEEPGRAM_KEY: &str = "deepgram-key";

fn keyed_settings(anthropic: &str, openai: &str) -> settings::Settings {
    settings::Settings {
        anthropic_api_key: anthropic.into(),
        openai_api_key: openai.into(),
        ..settings::Settings::default()
    }
}

fn key_of(provider_id: &str, s: &settings::Settings) -> Option<String> {
    provider_key(
        llm::registry::spec(provider_id).expect("провайдер объявлен"),
        s,
    )
}

#[test]
fn a_personal_key_reaches_its_vendor_directly() {
    let s = keyed_settings(ANTHROPIC_KEY, OPENAI_KEY);
    assert_eq!(
        key_of(llm::PROVIDER_ANTHROPIC, &s).as_deref(),
        Some(ANTHROPIC_KEY)
    );
    assert_eq!(
        key_of(llm::PROVIDER_OPENAI, &s).as_deref(),
        Some(OPENAI_KEY)
    );
}

#[test]
fn a_vendor_without_a_key_is_simply_absent() {
    let s = keyed_settings(ANTHROPIC_KEY, "");
    assert!(key_of(llm::PROVIDER_OPENAI, &s).is_none());
    assert!(key_of(llm::PROVIDER_ANTHROPIC, &s).is_some());
}

#[test]
fn the_router_is_never_left_without_a_provider() {
    let empty = settings::Settings::default();
    let catalog: llm::ModelCatalog = Arc::new(Mutex::new(Vec::new()));
    let client = build_llm_client(&empty, catalog, &llm::responses::probe::ModelProbes::in_memory());
    assert_eq!(client.provider_id(), llm::PROVIDER_ANTHROPIC);
    assert!(
        !client.known_models().is_empty(),
        "без провайдеров дефолтная модель чата стала бы немаршрутизируемой"
    );
}

/// Every credential the app knows, filled with a distinct value. A new key
/// field belongs here too — the test below is what tells you so.
fn all_keys_filled() -> settings::Settings {
    settings::Settings {
        anthropic_api_key: ANTHROPIC_KEY.into(),
        openai_api_key: OPENAI_KEY.into(),
        deepgram_api_key: DEEPGRAM_KEY.into(),
        ..settings::Settings::default()
    }
}

#[test]
fn every_registry_key_id_resolves_to_a_real_settings_field() {
    // `api_key_for` answers "" for an id it does not know, which would lock the
    // vendor forever with no error anywhere. This is the guard for that typo.
    let s = all_keys_filled();
    for spec in llm::registry::PROVIDERS {
        assert!(
            !settings::api_key_for(&s, spec.key_id).is_empty(),
            "key_id {} у {} не указывает ни на одно поле настроек — добавь поле и ветку в settings::api_key_for",
            spec.key_id,
            spec.id
        );
    }
    for spec in stt::registry::PROVIDERS {
        assert!(
            !settings::api_key_for(&s, spec.key_id).is_empty(),
            "key_id {} у STT-вендора {} не указывает ни на одно поле настроек",
            spec.key_id,
            spec.id
        );
    }
}

/// A settings file from the days of more vendors still names one of them; the
/// client is built for the vendor the app has, not for nothing.
#[test]
fn a_speech_vendor_the_app_no_longer_has_builds_the_default_engine() {
    for gone in ["groq", "openai", "xai", "openrouter"] {
        let s = settings::Settings {
            stt_provider: gone.into(),
            ..all_keys_filled()
        };
        let _engine = build_stt_client(&s);
        assert_eq!(
            stt::registry::resolve(&s.stt_provider).id,
            stt::registry::PROVIDER_DEEPGRAM,
            "{gone}"
        );
    }
}
