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
        assert!(p.keyterms.max > 0, "у {} нулевой предел терминов", p.id);
    }
}

#[test]
fn every_wire_profile_is_absolute_and_rooted() {
    for p in PROVIDERS {
        assert!(
            p.wire.base_url().starts_with("https://"),
            "{} обязан ходить по https",
            p.id
        );
        for path in [p.wire.path(), p.wire.warm_up_path()] {
            assert!(
                path.starts_with('/'),
                "путь {path} у {} не начинается со слэша",
                p.id
            );
            assert!(
                !path.ends_with('/'),
                "путь {path} у {} с хвостовым слэшем",
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
fn an_unknown_id_resolves_to_the_default_vendor() {
    // The single definition of that fallback: `Settings::clamp`, the client
    // builder and the frontend's key lookup all defer to it. Vendors the app
    // used to have (`groq`, `openai`, `xai`, `openrouter`) land here too.
    for gone in ["groq", "openai", "xai", "openrouter", ""] {
        assert_eq!(resolve(gone).id, default_spec().id, "{gone:?}");
    }
    assert_eq!(default_spec().id, PROVIDER_DEEPGRAM);
}

#[test]
fn a_known_id_resolves_to_itself() {
    for p in PROVIDERS {
        assert_eq!(resolve(p.id).id, p.id);
    }
    assert!(spec("нет такого").is_none());
}

#[test]
fn keyterms_are_capped_at_the_vendors_limit() {
    let terms: Vec<String> = (0..80).map(|i| format!("t{i}")).collect();
    let deepgram = spec(PROVIDER_DEEPGRAM).unwrap();
    assert_eq!(
        deepgram.keyterms.accepted(&terms).len(),
        deepgram.keyterms.max
    );
    assert_eq!(deepgram.keyterms.accepted(&terms[..3]).len(), 3);
}

/// Фабрика обязана собрать движок по КАЖДОЙ строке реестра — без паник и
/// без ветвления по вендору снаружи: диалект решает транспорт.
#[test]
fn every_row_builds_an_engine_through_the_factory() {
    for p in PROVIDERS {
        let _engine = crate::stt::build_engine(
            p,
            crate::stt::SttClientConfig {
                api_key: "k".into(),
                language: "ru".into(),
            },
        );
    }
}
