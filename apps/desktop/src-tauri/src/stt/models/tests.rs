use super::*;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn model(id: &str, name: &str, output: &str) -> serde_json::Value {
    serde_json::json!({
        "id": id, "name": name,
        "architecture": {"input_modalities": ["audio"], "output_modalities": [output]}
    })
}

#[tokio::test]
async fn fetches_only_transcription_models_without_credentials_and_deduplicates() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(CATALOG_PATH))
        .and(query_param("output_modalities", "transcription"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "data": [
                model("vendor/z", "Zebra", "transcription"),
                model("vendor/chat", "Audio chat", "text"),
                model("vendor/a", "Alpha", "transcription"),
                model("vendor/z", "Zebra", "transcription"),
                model("", "Broken", "transcription")
            ]
        })))
        .expect(1)
        .mount(&server)
        .await;
    let models = fetch_models(&warm_pooled_client(), &server.uri())
        .await
        .unwrap();
    assert_eq!(
        models.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
        ["vendor/a", "vendor/z"]
    );
    let requests = server.received_requests().await.unwrap();
    assert!(!requests[0].headers.contains_key("authorization"));
    assert!(!requests[0]
        .url
        .query_pairs()
        .any(|(key, _)| key == "limit" || key == "offset"));
}

#[tokio::test]
async fn failed_or_malformed_catalog_does_not_pretend_to_be_a_successful_empty_list() {
    for (status, body) in [(503, "unavailable"), (200, "{}"), (200, "not json")] {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(status).set_body_string(body))
            .mount(&server)
            .await;
        assert!(fetch_models(&warm_pooled_client(), &server.uri())
            .await
            .is_err());
    }
}
