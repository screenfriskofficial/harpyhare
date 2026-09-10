use super::*;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn client(server: &MockServer) -> SttHttpClient {
    SttHttpClient::for_provider(registry::PROVIDER_OPENROUTER, "sk-or-test".into())
        .with_base_url(server.uri())
}

#[tokio::test]
async fn factory_uses_the_selected_model_only_for_openrouter() {
    for id in [registry::PROVIDER_OPENROUTER, registry::PROVIDER_OPENAI] {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!({"text":"ok"})),
            )
            .expect(1)
            .mount(&server)
            .await;
        let spec = registry::resolve(id);
        let engine = build_engine(
            spec,
            SttClientConfig {
                api_key: "test".into(),
                proxy_base_url: Some(server.uri()),
                model: Some("vendor/selected-model".into()),
                language: "ru".into(),
                translate: false,
            },
        );
        assert_eq!(engine.transcribe(&[0.1], &[]).await.unwrap(), "ok");
        let requests = server.received_requests().await.unwrap();
        let body = String::from_utf8_lossy(&requests[0].body);
        assert_eq!(
            body.contains("vendor/selected-model"),
            id == registry::PROVIDER_OPENROUTER
        );
    }
}

#[tokio::test]
async fn multipart_transcription_uses_openrouter_auth_model_and_language() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v1/audio/transcriptions"))
        .and(header("authorization", "Bearer sk-or-test"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "text": "  Горутина в Go.  ", "usage": {"seconds": 1}
        })))
        .expect(1)
        .mount(&server)
        .await;

    // Switching from a translating vendor must retain the requested source
    // language and never invent an OpenRouter translations route or prompt.
    let result = client(&server)
        .with_translate(true)
        .transcribe(&vec![0.1; 16_000], &["Golang".into()])
        .await
        .unwrap();
    assert_eq!(result, "Горутина в Go.");
    let requests = server.received_requests().await.unwrap();
    let body = String::from_utf8_lossy(&requests[0].body);
    for part in [
        "name=\"model\"\r\n\r\nopenai/gpt-4o-mini-transcribe",
        "name=\"language\"\r\n\r\nru",
        "name=\"response_format\"\r\n\r\njson",
        "filename=\"audio.wav\"",
        "audio/wav",
        "RIFF",
        "WAVE",
    ] {
        assert!(body.contains(part), "missing multipart part: {part}");
    }
    for field in ["prompt", "keyterm", "temperature", "translate"] {
        assert!(!body.contains(&format!("name=\"{field}\"")));
    }
}

#[tokio::test]
async fn streaming_upload_wraps_pcm_in_wav_and_omits_autodetect_language() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v1/audio/transcriptions"))
        .and(header("authorization", "Bearer sk-or-test"))
        .and(header("transfer-encoding", "chunked"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"text": "ok"})))
        .expect(1)
        .mount(&server)
        .await;
    let chunks = futures_util::stream::iter([Ok(vec![1, 2]), Ok(vec![3, 4])]);
    let result = client(&server)
        .with_language(String::new())
        .transcribe_stream(
            Box::pin(chunks),
            &[],
            tokio_util::sync::CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(result, "ok");
    let requests = server.received_requests().await.unwrap();
    let mut audio = audio::wav_header_streaming().to_vec();
    audio.extend_from_slice(&[1, 2, 3, 4]);
    assert!(requests[0]
        .body
        .windows(audio.len())
        .any(|bytes| bytes == audio));
    assert!(!String::from_utf8_lossy(&requests[0].body).contains("name=\"language\""));
}

#[tokio::test]
async fn errors_identify_the_key_and_preserve_credit_and_retry_failures() {
    for status in [401, 403, 402, 429, 503, 200] {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(
                ResponseTemplate::new(status).set_body_json(serde_json::json!({
                    "error": {"message": "Insufficient credits"}
                })),
            )
            .expect(1)
            .mount(&server)
            .await;
        let error = client(&server).transcribe(&[0.1], &[]).await.unwrap_err();
        match status {
            401 => assert!(matches!(error, SttError::BadApiKey("OpenRouter"))),
            403 => assert_eq!(
                crate::error::CodedError::code(&error),
                crate::error::ErrorCode::AccessDenied
            ),
            429 | 503 => assert!(matches!(error, SttError::Retryable(code) if code == status)),
            402 => assert!(
                matches!(error, SttError::Http(ref failure) if failure.code == crate::error::ErrorCode::Billing)
            ),
            200 => assert!(matches!(error, SttError::Other(_))),
            _ => unreachable!(),
        }
    }
}

#[tokio::test]
async fn cancellation_stops_an_unfinished_recording_upload() {
    let server = MockServer::start().await;
    let cancel = tokio_util::sync::CancellationToken::new();
    let cancel_request = cancel.clone();
    let chunks = Box::pin(futures_util::stream::pending());
    let stt = client(&server);
    let send = stt.transcribe_stream(chunks, &[], cancel);
    let stop = async move {
        tokio::task::yield_now().await;
        cancel_request.cancel();
    };
    let (result, ()) = tokio::time::timeout(std::time::Duration::from_secs(1), async {
        tokio::join!(send, stop)
    })
    .await
    .expect("cancelled upload must finish promptly");
    assert!(matches!(result, Err(SttError::Cancelled)));
}
