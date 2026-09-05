use super::*;

/// Conformance suite: every row has to satisfy these, whoever added it. A
/// vendor that breaks one fails here rather than mid-interview, where the
/// symptom is a recording that comes back empty or 404s.
#[test]
fn every_provider_is_well_formed() {
    assert!(!PROVIDERS.is_empty(), "хотя бы один вендор обязателен");
    for p in PROVIDERS {
        assert!(!p.id.is_empty(), "у вендора пустой id");
        assert!(!p.label.is_empty(), "у {} пустая подпись", p.id);
        assert!(!p.key_id.is_empty(), "у {} пустой key_id", p.id);
        assert!(!p.key_label.is_empty(), "у {} пустой key_label", p.id);
    }
}

#[test]
fn every_wire_profile_is_absolute_and_rooted() {
    for p in PROVIDERS {
        assert!(p.wire.base_url().starts_with("https://"), "{} обязан ходить по https", p.id);
        let paths = [p.wire.path(false), p.wire.path(true), p.wire.warm_up_path()];
        for path in paths {
            assert!(path.starts_with('/'), "путь {path} у {} не начинается со слэша", p.id);
            assert!(!path.ends_with('/'), "путь {path} у {} с хвостовым слэшем", p.id);
        }
    }
}

#[test]
fn every_openai_dialect_row_names_a_model_and_valid_optional_translation() {
    for p in PROVIDERS {
        let SttWire::OpenAiMultipart {
            transcribe_path,
            transcribe_model,
            translation,
            ..
        } = p.wire
        else {
            continue;
        };
        assert!(!transcribe_model.is_empty(), "у {} пустая модель распознавания", p.id);
        if let Some(translation) = translation {
            assert!(!translation.model.is_empty(), "у {} пустая модель перевода", p.id);
            assert_ne!(
                transcribe_path, translation.path,
                "у {} распознавание и перевод не могут делить эндпоинт",
                p.id
            );
        }
    }
}

#[test]
fn provider_ids_are_unique() {
    let mut ids: Vec<&str> = PROVIDERS.iter().map(|p| p.id).collect();
    ids.sort_unstable();
    let before = ids.len();
    ids.dedup();
    assert_eq!(ids.len(), before, "id вендоров повторяются");
}

#[test]
fn only_a_vendor_with_a_second_endpoint_claims_translation() {
    // `supports_translate` is what the launcher greys the toggle on, so it has
    // to match what the wire can actually do.
    for p in PROVIDERS {
        let has_second_endpoint = p.wire.path(false) != p.wire.path(true);
        assert_eq!(
            p.supports_translate, has_second_endpoint,
            "{}: обещание перевода разошлось с наличием эндпоинта",
            p.id
        );
    }
}

#[test]
fn translation_is_dropped_for_a_vendor_that_cannot_do_it() {
    for p in PROVIDERS {
        assert!(!effective_translate(p, false), "{}", p.id);
        assert_eq!(effective_translate(p, true), p.supports_translate, "{}", p.id);
    }
    let xai = spec(PROVIDER_XAI).expect("xai объявлен");
    assert!(!effective_translate(xai, true), "у xAI нет перевода — запрос обязан деградировать");
}

#[test]
fn path_follows_the_translate_flag_only_where_there_is_a_second_endpoint() {
    for p in PROVIDERS {
        if p.supports_translate {
            assert_ne!(p.wire.path(false), p.wire.path(true), "{}", p.id);
        } else {
            assert_eq!(p.wire.path(false), p.wire.path(true), "{}", p.id);
        }
    }
}

#[test]
fn a_dialect_shared_by_several_vendors_needs_no_code_per_vendor() {
    let shared: Vec<&str> = PROVIDERS
        .iter()
        .filter(|p| matches!(p.wire, SttWire::OpenAiMultipart { .. }))
        .map(|p| p.id)
        .collect();
    assert!(shared.len() >= 2, "диалект OpenAI обслуживает больше одного вендора");
    assert!(shared.contains(&PROVIDER_GROQ));
    assert!(shared.contains(&PROVIDER_OPENAI));
}

#[test]
fn an_unknown_id_resolves_to_the_default_vendor() {
    // The single definition of that fallback: `Settings::clamp`, the client
    // builder and the frontend's key lookup all defer to it.
    assert_eq!(resolve("elevenlabs").id, default_spec().id);
    assert_eq!(resolve("").id, default_spec().id);
    assert_eq!(default_spec().id, PROVIDER_GROQ);
}

#[test]
fn a_known_id_resolves_to_itself() {
    for p in PROVIDERS {
        assert_eq!(resolve(p.id).id, p.id);
    }
}

#[test]
fn lookup_finds_declared_vendors_and_nothing_else() {
    for id in [PROVIDER_GROQ, PROVIDER_OPENAI, PROVIDER_XAI, PROVIDER_DEEPGRAM, PROVIDER_OPENROUTER] {
        assert_eq!(spec(id).map(|p| p.id), Some(id));
    }
    assert!(spec("нет такого").is_none());
}

/// The registry is the contract a future vendor is added against, so the shape
/// of a row is asserted independently of the ones that exist today.
#[test]
fn a_row_needs_nothing_but_data_to_be_well_formed() {
    const SCRIBE: SttProviderSpec = SttProviderSpec {
        id: "elevenlabs",
        label: "ElevenLabs · Scribe v2",
        key_id: "elevenlabs",
        proxied: false,
        supports_translate: true,
        keyterms: SttKeyterms::Prompt { field: "prompt" },
        key_label: "ElevenLabs",
        wire: SttWire::OpenAiMultipart {
            base_url: "https://api.elevenlabs.io",
            transcribe_path: "/v1/speech-to-text",
            warm_up_path: "/v1/models",
            transcribe_model: "scribe-v2",
            translation: Some(SttTranslation {
                path: "/v1/speech-to-text/translate",
                model: "scribe-v2",
            }),
            temperature: None,
        },
    };

    assert_eq!(SCRIBE.wire.path(true), "/v1/speech-to-text/translate");
    assert_eq!(SCRIBE.wire.base_url(), "https://api.elevenlabs.io");
    assert!(effective_translate(&SCRIBE, true));
}

/// Фабрика обязана собрать движок по КАЖДОЙ строке реестра — без паник и
/// без ветвления по вендору снаружи: диалект решает транспорт.
#[test]
fn every_row_builds_an_engine_through_the_factory() {
    for p in PROVIDERS {
        let _engine = crate::stt::build_engine(
            p,
            crate::stt::SttClientConfig {
                model: None,
                api_key: "k".into(),
                proxy_base_url: None,
                language: "ru".into(),
                translate: false,
            },
        );
    }
}
