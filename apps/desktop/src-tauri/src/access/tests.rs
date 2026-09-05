use super::*;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[tokio::test]
async fn redeem_returns_token_on_success() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(REDEEM_PATH))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(serde_json::json!({"token": "itk_abc"})),
        )
        .mount(&server)
        .await;
    let token = redeem(&server.uri(), "CODE-1234", "idem-1").await.unwrap();
    assert_eq!(token, "itk_abc");
}

#[tokio::test]
async fn redeem_surfaces_proxy_error_message() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(404).set_body_json(serde_json::json!({
            "error": {"message": "Код недействителен или уже использован"}
        })))
        .mount(&server)
        .await;
    let err = redeem(&server.uri(), "BAD", "idem-2").await.unwrap_err();
    assert_eq!(err, "Код недействителен или уже использован");
}

#[tokio::test]
async fn redeem_rejects_empty_token() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"token": ""})))
        .mount(&server)
        .await;
    let err = redeem(&server.uri(), "CODE", "idem-3").await.unwrap_err();
    assert_eq!(err, REDEEM_EMPTY_TOKEN);
}

#[tokio::test]
async fn redeem_maps_unparseable_success_body() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_string("not json"))
        .mount(&server)
        .await;
    let err = redeem(&server.uri(), "CODE", "idem-4").await.unwrap_err();
    assert_eq!(err, REDEEM_BAD_RESPONSE);
}

#[tokio::test]
async fn a_rate_limited_redeem_names_the_limit_not_the_code() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(429))
        .mount(&server)
        .await;
    let err = redeem(&server.uri(), "CODE", "idem-5").await.unwrap_err();
    assert_eq!(err, REDEEM_RATE_LIMITED);
}
