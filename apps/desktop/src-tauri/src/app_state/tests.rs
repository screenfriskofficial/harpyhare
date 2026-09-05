use super::*;

const GROQ_KEY: &str = "groq-key";
const OPENAI_KEY: &str = "openai-key";
const ACCESS_TOKEN: &str = "itk_token";

fn settings_with(provider: &str, access_token: &str) -> settings::Settings {
    settings::Settings {
        stt_provider: provider.into(),
        access_token: access_token.into(),
        groq_api_key: GROQ_KEY.into(),
        openai_api_key: OPENAI_KEY.into(),
        ..settings::Settings::default()
    }
}

#[test]
fn direct_groq_takes_the_groq_key_and_talks_to_the_vendor() {
    let plan = stt_client_plan(&settings_with(settings::STT_PROVIDER_GROQ, ""));
    assert_eq!(plan.provider_id, stt::registry::PROVIDER_GROQ);
    assert_eq!(plan.api_key, GROQ_KEY);
    assert_eq!(plan.proxy_base_url, None);
}

#[test]
fn direct_openai_takes_the_openai_key_and_talks_to_the_vendor() {
    let plan = stt_client_plan(&settings_with(settings::STT_PROVIDER_OPENAI, ""));
    assert_eq!(plan.provider_id, stt::registry::PROVIDER_OPENAI);
    assert_eq!(plan.api_key, OPENAI_KEY);
    assert_eq!(plan.proxy_base_url, None);
}

#[test]
fn proxy_groq_swaps_the_key_for_the_token_and_the_host_for_the_proxy() {
    let plan = stt_client_plan(&settings_with(settings::STT_PROVIDER_GROQ, ACCESS_TOKEN));
    assert_eq!(plan.provider_id, stt::registry::PROVIDER_GROQ);
    assert_eq!(plan.api_key, ACCESS_TOKEN);
    assert_eq!(plan.proxy_base_url, Some(access::proxy_base_url()));
}

#[test]
fn proxy_openai_keeps_the_vendor_and_only_swaps_key_and_host() {
    let plan = stt_client_plan(&settings_with(settings::STT_PROVIDER_OPENAI, ACCESS_TOKEN));
    assert_eq!(plan.provider_id, stt::registry::PROVIDER_OPENAI);
    assert_eq!(plan.api_key, ACCESS_TOKEN);
    assert_eq!(plan.proxy_base_url, Some(access::proxy_base_url()));
}

#[test]
fn an_unknown_provider_falls_back_to_groq() {
    let plan = stt_client_plan(&settings_with("elevenlabs", ""));
    assert_eq!(plan.provider_id, stt::registry::PROVIDER_GROQ);
    assert_eq!(plan.api_key, GROQ_KEY);
}

const ANTHROPIC_KEY: &str = "anthropic-key";
const XAI_KEY: &str = "xai-key";
const DEEPGRAM_KEY: &str = "deepgram-key";
const XCLIS_KEY: &str = "xclis-key";

fn keyed_settings(anthropic: &str, openai: &str, access_token: &str) -> settings::Settings {
    settings::Settings {
        anthropic_api_key: anthropic.into(),
        openai_api_key: openai.into(),
        access_token: access_token.into(),
        ..settings::Settings::default()
    }
}

fn access_of(provider_id: &str, s: &settings::Settings) -> Option<ProviderAccess> {
    provider_access(llm::registry::spec(provider_id).expect("провайдер объявлен"), s)
}

#[test]
fn a_personal_key_reaches_its_vendor_directly() {
    let s = keyed_settings(ANTHROPIC_KEY, OPENAI_KEY, "");
    assert!(matches!(
        access_of(llm::PROVIDER_ANTHROPIC, &s),
        Some(ProviderAccess::Direct { api_key }) if api_key == ANTHROPIC_KEY
    ));
    assert!(matches!(
        access_of(llm::PROVIDER_OPENAI, &s),
        Some(ProviderAccess::Direct { api_key }) if api_key == OPENAI_KEY
    ));
}

#[test]
fn a_vendor_without_a_key_is_simply_absent() {
    let s = keyed_settings(ANTHROPIC_KEY, "", "");
    assert!(access_of(llm::PROVIDER_OPENAI, &s).is_none());
    assert!(access_of(llm::PROVIDER_ANTHROPIC, &s).is_some());
}

#[test]
fn an_access_code_reaches_every_proxied_vendor_without_any_personal_key() {
    let s = keyed_settings("", "", ACCESS_TOKEN);
    for spec in llm::registry::PROVIDERS.iter().filter(|p| p.proxied) {
        assert!(
            matches!(
                provider_access(spec, &s),
                Some(ProviderAccess::Proxied { ref access_token, .. }) if access_token == ACCESS_TOKEN
            ),
            "код доступа обязан открывать {}",
            spec.id
        );
    }
}

#[test]
fn an_access_code_wins_over_a_personal_key_for_proxied_vendors() {
    let s = keyed_settings(ANTHROPIC_KEY, OPENAI_KEY, ACCESS_TOKEN);
    assert!(matches!(
        access_of(llm::PROVIDER_ANTHROPIC, &s),
        Some(ProviderAccess::Proxied { .. })
    ));
}

#[test]
fn the_router_is_never_left_without_a_provider() {
    let empty = settings::Settings::default();
    let catalog: llm::ModelCatalog = Arc::new(Mutex::new(Vec::new()));
    let client = build_llm_client(&empty, catalog);
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
        groq_api_key: GROQ_KEY.into(),
        openai_api_key: OPENAI_KEY.into(),
        xai_api_key: XAI_KEY.into(),
        deepgram_api_key: DEEPGRAM_KEY.into(),
        xclis_api_key: XCLIS_KEY.into(),
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

#[test]
fn a_vendor_the_relay_does_not_proxy_stays_locked_under_an_access_code() {
    // Grok has no relay route, so a code must not pretend to unlock it.
    let s = keyed_settings("", "", ACCESS_TOKEN);
    for spec in llm::registry::PROVIDERS.iter().filter(|p| !p.proxied) {
        assert!(
            provider_access(spec, &s).is_none(),
            "{} не проксируется — код доступа не должен его открывать",
            spec.id
        );
    }
}

/// Речевой вендор без роута на relay (Deepgram) под кодом доступа берёт
/// личный ключ и ходит к вендору напрямую — зеркало правила про ответы.
#[test]
fn a_speech_vendor_the_relay_does_not_proxy_keeps_its_own_key_under_a_code() {
    let s = settings::Settings {
        stt_provider: stt::registry::PROVIDER_DEEPGRAM.into(),
        access_token: ACCESS_TOKEN.into(),
        deepgram_api_key: DEEPGRAM_KEY.into(),
        ..settings::Settings::default()
    };
    let plan = stt_client_plan(&s);
    assert_eq!(plan.provider_id, stt::registry::PROVIDER_DEEPGRAM);
    assert_eq!(plan.api_key, DEEPGRAM_KEY);
    assert_eq!(plan.proxy_base_url, None);
}
