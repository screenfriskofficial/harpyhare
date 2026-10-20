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
    let http = direct_key_header()
        .with_headers(&[("anthropic-version", "2023-06-01")])
        .with_read_timeout(Duration::from_secs(5))
        .with_base_url("https://other.test".into());
    assert_eq!(http.url("/v1/models"), "https://other.test/v1/models");
    assert_eq!(http.headers, &[("anthropic-version", "2023-06-01")]);
    assert_eq!(http.options.read_timeout, Duration::from_secs(5));
}
