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
        // Пустой каталог допустим ровно у вендора с динамическим составом
        // (агрегатор): у него список моделей привязан к ключу, и офлайн честный
        // ответ — «пока не знаю». Пара «пустой каталог ⇄ пустой дефолт»
        // проверяется отдельно в `every_provider_defaults_to_a_model_it_actually_offers`.
        for m in p.catalog {
            assert!(!m.id.is_empty(), "в каталоге {} модель без id", p.id);
            assert!(!m.display_name.is_empty(), "{} без display_name", m.id);
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
    let mut ids: Vec<&str> = PROVIDERS.iter().flat_map(|p| p.catalog).map(|m| m.id).collect();
    ids.sort_unstable();
    let before = ids.len();
    ids.dedup();
    assert_eq!(ids.len(), before, "один id модели заявлен двумя вендорами — роутер не разберётся");
}

#[test]
fn every_declared_family_matches_something_in_the_catalog() {
    for p in PROVIDERS {
        for family in p.families {
            assert!(
                p.catalog.iter().any(|m| m.id.contains(family)),
                "семейство {family} у {} не совпало ни с одной моделью каталога",
                p.id
            );
        }
    }
}

#[test]
fn catalog_models_are_tagged_with_their_provider_and_unknown_window() {
    for p in PROVIDERS {
        let models = p.models();
        assert_eq!(models.len(), p.catalog.len());
        for m in &models {
            assert_eq!(m.provider, p.id, "модель {} не помечена вендором", m.id);
            assert_eq!(
                m.max_input_tokens, UNKNOWN_MAX_INPUT_TOKENS,
                "окно контекста берётся только из живого API"
            );
        }
    }
}

/// Вендор с динамическим каталогом (Xclis) офлайн не обещает ничего и потому
/// не называет дефолта: пустой каталог обязан идти в паре с пустым дефолтом,
/// иначе новый чат открылся бы на модели, которой у провайдера нет.
#[test]
fn every_provider_defaults_to_a_model_it_actually_offers() {
    for p in PROVIDERS {
        if p.catalog.is_empty() {
            assert!(
                p.default_model.is_empty(),
                "{} офлайн не предлагает моделей, но называет дефолт {}",
                p.id,
                p.default_model
            );
            continue;
        }
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
        PROVIDERS.iter().flat_map(|p| p.catalog).any(|m| m.id == super::super::DEFAULT_MODEL),
        "дефолт нового чата обязан быть в каталоге — иначе селект открывается пустым"
    );
}

#[test]
fn lookup_finds_declared_providers_and_nothing_else() {
    assert_eq!(spec(PROVIDER_ANTHROPIC).map(|p| p.id), Some(PROVIDER_ANTHROPIC));
    assert_eq!(spec(PROVIDER_OPENAI).map(|p| p.id), Some(PROVIDER_OPENAI));
    assert!(spec("нет такого").is_none());
    assert!(catalog_models("нет такого").is_empty());
}

#[test]
fn anthropic_catalog_matches_what_the_llm_port_hands_out_as_fallback() {
    assert_eq!(super::super::fallback_models(), catalog_models(PROVIDER_ANTHROPIC));
}

#[test]
fn a_dialect_shared_by_several_vendors_needs_no_code_per_vendor() {
    // The whole claim of the registry: Grok joined by declaring a row against
    // an existing dialect. If it ever needs its own module, this breaks first.
    let shared: Vec<&str> = PROVIDERS
        .iter()
        .filter(|p| matches!(p.wire, LlmWire::Responses { .. }))
        .map(|p| p.id)
        .collect();
    assert!(shared.len() >= 2, "диалект Responses обслуживает больше одного вендора");
    assert!(shared.contains(&PROVIDER_OPENAI));
    assert!(shared.contains(&super::super::PROVIDER_XAI));
}

#[test]
fn every_row_declares_a_reachable_https_host() {
    for p in PROVIDERS {
        assert!(p.wire.base_url().starts_with("https://"), "{} обязан ходить по https", p.id);
        assert!(!p.wire.key_label().is_empty(), "у {} пустой key_label", p.id);
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
        families: &["pro"],
        catalog: &[CatalogModel {
            id: "gemini-3-pro",
            display_name: "Gemini 3 Pro",
            adaptive: true,
            always_thinks: false,
            code_exec: true,
        }],
        default_model: "gemini-3-pro",
        proxied: false,
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
    assert_eq!(models[0].max_input_tokens, UNKNOWN_MAX_INPUT_TOKENS);
    assert!(GEMINI.families.iter().all(|f| GEMINI.catalog.iter().any(|m| m.id.contains(f))));
}

/// Состав моделей Xclis задаётся группой аккаунта на его стороне и меняется без
/// нашего участия — проверено двумя ключами с непересекающимися каталогами.
/// Любая вписанная сюда модель была бы обещанием, которое вендор не давал.
#[test]
fn xclis_promises_nothing_offline() {
    let xclis = PROVIDERS
        .iter()
        .find(|p| p.id == xclis::PROVIDER_XCLIS)
        .expect("строка Xclis в реестре");
    assert!(xclis.catalog.is_empty(), "каталог Xclis известен только из живого /v1/models");
    assert!(xclis.default_model.is_empty(), "дефолт Xclis тоже приходит из живого каталога");
}

/// У relay нет роута под Chat Completions Xclis, а у самого диалекта — прокси-
/// режима: `build_provider` при `proxied: true` пропустил бы вендора у каждого
/// держателя кода доступа. Перевернуть флаг можно только вместе с диалектом.
#[test]
fn the_xclis_dialect_cannot_be_proxied() {
    for p in PROVIDERS.iter().filter(|p| matches!(p.wire, LlmWire::Xclis { .. })) {
        assert!(!p.proxied, "{}: диалект Xclis не умеет ходить через relay", p.id);
    }
}
