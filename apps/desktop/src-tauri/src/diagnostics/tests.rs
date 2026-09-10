use super::*;

#[test]
fn bounded_report_and_allowlisted_fields_do_not_export_secrets() {
    let trace = Trace::new(
        DiagnosticKind::Answer,
        DiagnosticOrigin::Session,
        "openai",
        "sk-private-secret",
        true,
    );
    let record = trace.finish(Some(ErrorCode::Billing));
    let json = serde_json::to_string(&record).unwrap();
    assert!(!json.contains("sk-private-secret"));
    assert!(!json.contains("message"));
    assert!(!json.contains("apiKey"));
    let mut store = RecordStore::default();
    for _ in 0..RECORD_LIMIT + 10 {
        store.push(record.clone());
    }
    assert_eq!(store.0.len(), RECORD_LIMIT);
    for value in [
        "Bearer abc",
        "itk_token",
        "https://host?key=secret",
        "\nsecret",
        "eyJhbGciOi",
    ] {
        assert!(safe_identifier(value).is_none(), "{value}");
    }
}

#[tokio::test]
async fn concurrent_requests_keep_their_own_metadata_and_ignore_unscoped_traffic() {
    let a = Trace::new(
        DiagnosticKind::Answer,
        DiagnosticOrigin::Session,
        "openai",
        "model-a",
        false,
    );
    let b = Trace::new(
        DiagnosticKind::Answer,
        DiagnosticOrigin::Session,
        "anthropic",
        "model-b",
        true,
    );
    let run = |trace: Trace, id: &'static str| async move {
        trace
            .scope(async {
                tokio::task::yield_now().await;
                let mut headers = reqwest::header::HeaderMap::new();
                headers.insert("x-request-id", id.parse().unwrap());
                headers.insert("authorization", "Bearer private".parse().unwrap());
                headers.insert("retry-after", "7".parse().unwrap());
                observe_response(429, &headers);
            })
            .await;
        trace.finish(Some(ErrorCode::RateLimited))
    };
    let (a, b) = tokio::join!(run(a, "req_a"), run(b, "req_b"));
    assert_eq!(a.requests[0].request_id.as_deref(), Some("req_a"));
    assert_eq!(b.requests[0].request_id.as_deref(), Some("req_b"));
    assert_eq!(b.requests[0].retry_after_seconds, Some(7));
    assert!(!serde_json::to_string(&b).unwrap().contains("private"));
}

#[test]
fn first_text_ignores_empty_deltas_and_finishing_is_idempotent() {
    let trace = Trace::new(
        DiagnosticKind::Answer,
        DiagnosticOrigin::Session,
        "openai",
        "model",
        false,
    );
    trace.first_text(" \n");
    assert!(trace.inner.lock_unpoisoned().0.first_text_ms.is_none());
    trace.first_text("OK");
    let record = trace.finish(None);
    assert!(record.first_text_ms.is_some());
    assert_eq!(trace.finish(Some(ErrorCode::Internal)).error_code, None);
}

#[tokio::test]
async fn request_timings_and_metadata_exclude_url_and_response_body() {
    use wiremock::{matchers::path, Mock, MockServer, ResponseTemplate};
    let server = MockServer::start().await;
    Mock::given(path("/v1/messages"))
        .respond_with(
            ResponseTemplate::new(402)
                .set_delay(Duration::from_millis(20))
                .insert_header("request-id", "req_payment")
                .set_body_string("private response text"),
        )
        .mount(&server)
        .await;
    let trace = Trace::new(
        DiagnosticKind::Answer,
        DiagnosticOrigin::Preflight,
        "anthropic",
        "model",
        false,
    );
    trace
        .scope(async {
            let response = send_request(
                reqwest::Client::new()
                    .get(format!("{}/v1/messages?key=private", server.uri()))
                    .send(),
            )
            .await
            .unwrap();
            assert_eq!(response.status(), 402);
        })
        .await;
    let record = trace.finish(Some(ErrorCode::Billing));
    assert_eq!(record.requests.len(), 1);
    let request = &record.requests[0];
    assert!(matches!(request.kind, HttpRequestKind::Answer));
    assert!(request.elapsed_ms >= request.request_started_ms.unwrap() + 15);
    assert!(record.total_ms >= request.elapsed_ms);
    assert_eq!(request.request_id.as_deref(), Some("req_payment"));
    let serialized = serde_json::to_string(&record).unwrap();
    assert!(!serialized.contains("private"));
    assert!(!serialized.contains(&server.uri()));
}
