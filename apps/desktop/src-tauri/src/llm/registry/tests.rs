use super::*;

/// Conformance suite: every row of the registry has to satisfy these, whoever
/// added it. A new vendor that breaks one of them fails here rather than in the
/// UI, where the symptom is a silently empty or permanently locked group.
#[test]
fn every_provider_is_well_formed() {
    assert!(!PROVIDERS.is_empty(), "хотя бы один провайдер обязателен");
    for p in PROVIDERS {
        assert!(!p.id.is_empty(), "у провайдера пустой id");
        assert!(!p.label.is_empty(), "у {} пустой label", p.id);
        assert!(!p.key_id.is_empty(), "у {} пустой key_id", p.id);
        // Офлайн-каталог — то, что пикер показывает до ключа, и то, по чему
        // роутер узнаёт владельца сохранённой модели без живого каталога.
        assert!(!p.catalog.is_empty(), "у {} пустой офлайн-каталог", p.id);
        for m in p.catalog {
            assert!(!m.id.is_empty(), "в каталоге {} модель без id", p.id);
            assert!(!m.display_name.is_empty(), "{} без display_name", m.id);
            // The picker shows the ladder in this order, and a repeated level
            // would be a second item writing the same value.
            assert!(
                m.efforts.windows(2).all(|w| w[0] < w[1]),
                "уровни effort у {} не по возрастанию или повторяются",
                m.id
            );
            // A model that cannot reason has nothing for effort to tune.
            assert!(
                m.adaptive || m.budget_thinking || m.always_thinks || m.efforts.is_empty(),
                "{} не рассуждает, но заявляет effort",
                m.id
            );
            // The picker shows the default checked; it has to be on the ladder.
            assert_eq!(
                m.default_effort.is_some(),
                !m.efforts.is_empty(),
                "у {} уровень по умолчанию не согласован с лестницей",
                m.id
            );
            if let Some(default) = m.default_effort {
                assert!(m.efforts.contains(&default), "{}: {default:?} не в лестнице", m.id);
            }
        }
    }
}

#[test]
fn provider_ids_are_unique() {
    let mut ids: Vec<&str> = PROVIDERS.iter().map(|p| p.id).collect();
    ids.sort_unstable();
    let before = ids.len();
    ids.dedup();
    assert_eq!(ids.len(), before, "id провайдеров повторяются");
}

#[test]
fn model_ids_are_unique_across_all_providers() {
    let mut ids: Vec<&str> = PROVIDERS
        .iter()
        .flat_map(|p| p.catalog)
        .map(|m| m.id)
        .collect();
    ids.sort_unstable();
    let before = ids.len();
    ids.dedup();
    assert_eq!(
        ids.len(),
        before,
        "один id модели заявлен двумя вендорами — роутер не разберётся"
    );
}

#[test]
fn catalog_models_are_tagged_with_their_provider() {
    for p in PROVIDERS {
        let models = p.models();
        assert_eq!(models.len(), p.catalog.len());
        for m in &models {
            assert_eq!(m.provider, p.id, "модель {} не помечена вендором", m.id);
        }
    }
}

/// Иначе новый чат открылся бы на модели, которой у провайдера нет.
#[test]
fn every_provider_defaults_to_a_model_it_actually_offers() {
    for p in PROVIDERS {
        assert!(
            p.catalog.iter().any(|m| m.id == p.default_model),
            "дефолт {} у {} не в его же каталоге — новый чат открылся бы на недоступной модели",
            p.default_model,
            p.id
        );
    }
}

#[test]
fn the_global_default_is_the_first_providers_default() {
    assert_eq!(PROVIDERS[0].default_model, super::super::DEFAULT_MODEL);
}

#[test]
fn default_model_is_offered_by_some_provider() {
    assert!(
        PROVIDERS
            .iter()
            .flat_map(|p| p.catalog)
            .any(|m| m.id == super::super::DEFAULT_MODEL),
        "дефолт нового чата обязан быть в каталоге — иначе селект открывается пустым"
    );
}

#[test]
fn lookup_finds_declared_providers_and_nothing_else() {
    assert_eq!(
        spec(PROVIDER_ANTHROPIC).map(|p| p.id),
        Some(PROVIDER_ANTHROPIC)
    );
    assert_eq!(spec(PROVIDER_OPENAI).map(|p| p.id), Some(PROVIDER_OPENAI));
    assert!(spec("нет такого").is_none());
    assert!(catalog_models("нет такого").is_empty());
}

#[test]
fn anthropic_catalog_matches_what_the_llm_port_hands_out_as_fallback() {
    assert_eq!(
        super::super::fallback_models(),
        catalog_models(PROVIDER_ANTHROPIC)
    );
}

#[test]
fn every_row_declares_a_reachable_https_host() {
    for p in PROVIDERS {
        assert!(
            p.wire.base_url().starts_with("https://"),
            "{} обязан ходить по https",
            p.id
        );
        assert!(
            !p.wire.key_label().is_empty(),
            "у {} пустой key_label",
            p.id
        );
    }
}

/// The registry is the contract a future vendor is added against, so the shape
/// of a row is asserted independently of the two vendors that happen to exist
/// today. If this stops compiling, the "add a vendor" instructions in CLAUDE.md
/// are out of date.
#[test]
fn a_row_needs_nothing_but_data_to_be_well_formed() {
    const GEMINI: LlmProviderSpec = LlmProviderSpec {
        id: "gemini",
        label: "Gemini",
        key_id: "gemini",
        catalog: &[CatalogModel {
            id: "gemini-3-pro",
            display_name: "Gemini 3 Pro",
            adaptive: true,
            always_thinks: false,
            code_exec: true,
            efforts: &[],
            budget_thinking: false,
            default_effort: None,
        }],
        default_model: "gemini-3-pro",
        wire: LlmWire::Responses {
            base_url: "https://generativelanguage.googleapis.com",
            key_label: "Google",
            effort_off: "none",
            effort_on: "medium",
        },
    };

    let models = GEMINI.models();
    assert_eq!(models.len(), 1);
    assert_eq!(models[0].provider, "gemini");
    assert_eq!(models[0].id, "gemini-3-pro");
}
