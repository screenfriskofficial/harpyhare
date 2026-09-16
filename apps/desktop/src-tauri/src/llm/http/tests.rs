use super::*;

const KEY_LABEL: &str = "Тест";
const BASE: &str = "https://api.example.test";

fn direct_key_header() -> LlmHttp {
    LlmHttp::direct(
        BASE,
        Credential::ApiKeyHeader {
            header: "x-api-key",
            key: "secret".into(),
        },
        KEY_LABEL,
    )
}

#[test]
fn direct_transport_is_not_in_proxy_mode() {
    assert!(!direct_key_header().is_proxy());
    assert!(!LlmHttp::direct(BASE, Credential::Bearer("k".into()), KEY_LABEL).is_proxy());
}

#[test]
fn proxied_transport_is_in_proxy_mode() {
    // The distinction is load-bearing: it decides whether a 401 blames the
    // user's key or is reported as the relay's own API error.
    assert!(LlmHttp::proxied(BASE, "itk_token".into(), KEY_LABEL).is_proxy());
}

#[test]
fn proxied_keeps_the_base_url_it_was_given() {
    let http = LlmHttp::proxied("https://relay.test", "itk_token".into(), KEY_LABEL);
    assert_eq!(http.url("/v1/messages"), "https://relay.test/v1/messages");
}

#[test]
fn urls_are_the_base_plus_the_path_verbatim() {
    let http = direct_key_header();
    assert_eq!(http.url("/v1/models"), "https://api.example.test/v1/models");
    // Query strings ride along in `path`; nothing rewrites them.
    assert_eq!(
        http.url("/v1/models?limit=100"),
        "https://api.example.test/v1/models?limit=100"
    );
}

#[test]
fn with_base_url_swaps_the_host_and_keeps_everything_else() {
    let http = direct_key_header().with_base_url("https://other.test".into());
    assert!(!http.is_proxy());
    assert_eq!(http.url("/v1/models"), "https://other.test/v1/models");
}

#[test]
fn builders_do_not_flip_proxy_mode() {
    let http = LlmHttp::proxied(BASE, "itk_token".into(), KEY_LABEL)
        .with_headers(&[("anthropic-version", "2023-06-01")])
        .with_read_timeout(Duration::from_secs(5))
        .with_base_url("https://relay.test".into());
    assert!(
        http.is_proxy(),
        "прокси-режим обязан пережить любую настройку"
    );
}
