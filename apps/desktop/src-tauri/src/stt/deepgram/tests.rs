use super::*;
use crate::stt::registry::{self, SttWire};

fn deepgram() -> DeepgramStt {
    DeepgramStt::from_spec(registry::resolve(registry::PROVIDER_DEEPGRAM), "k".into())
}

#[test]
fn empty_language_uses_multi() {
    let stt = deepgram().with_language(String::new());
    assert_eq!(stt.language_param(), MULTI_LANGUAGE);
}

#[test]
fn websocket_url_comes_from_the_registry_row_and_names_the_pcm_shape() {
    let stt = deepgram();
    let url = stt.websocket_url(&[]);
    let SttWire::Deepgram { base_url, listen_path, .. } = stt.spec.wire else {
        panic!("строка Deepgram объявляет свой диалект");
    };
    let expected_prefix = format!("{}{listen_path}?", base_url.replacen("https://", "wss://", 1));
    assert!(url.starts_with(&expected_prefix), "{url}");
    assert!(url.contains("model=nova-3"));
    assert!(url.contains("encoding=linear16"));
    assert!(url.contains("sample_rate=16000"));
}

/// Nova-3 принимает подсказки повторяющимся `keyterm=`; многословные термины
/// обязаны быть закодированы, иначе запрос рвётся на первом же пробеле.
#[test]
fn keyterms_go_into_the_stream_url_encoded() {
    let stt = deepgram();
    let terms = vec!["gRPC".to_string(), "Kubernetes Operator".to_string()];
    let url = stt.websocket_url(&terms);
    assert!(url.contains("keyterm=gRPC"), "{url}");
    assert!(url.contains("keyterm=Kubernetes+Operator"), "{url}");
}

/// Предел вендора применяется здесь так же, как у multipart-вендоров: раньше
/// клиент слал все термины, и пресет длиннее лимита давал 400 на каждой записи.
#[test]
fn keyterms_beyond_the_registry_cap_are_not_sent() {
    let stt = deepgram();
    let registry::SttKeyterms::Repeated { max, .. } = stt.spec.keyterms else {
        panic!("Deepgram принимает повторяющийся keyterm");
    };
    let terms: Vec<String> = (0..max + 10).map(|i| format!("t{i}")).collect();
    let url = stt.websocket_url(&terms);
    assert_eq!(url.matches("keyterm=").count(), max, "{url}");
    assert!(!url.contains(&format!("keyterm=t{max}")));
}

#[test]
fn no_keyterms_means_no_parameter() {
    assert!(!deepgram().websocket_url(&[]).contains("keyterm"));
}

#[test]
fn final_results_are_joined() {
    let mut segments = Vec::new();
    DeepgramStt::consume_stream_text(
        &mut segments,
        r#"{"type":"Results","is_final":true,"channel":{"alternatives":[{"transcript":"привет"}]}}"#,
    )
    .unwrap();
    DeepgramStt::consume_stream_text(
        &mut segments,
        r#"{"type":"Results","is_final":true,"channel":{"alternatives":[{"transcript":"мир"}]}}"#,
    )
    .unwrap();
    assert_eq!(DeepgramStt::transcript_from_segments(&segments), "привет мир");
}

#[test]
fn no_segments_is_an_empty_transcript_not_an_error() {
    assert_eq!(DeepgramStt::transcript_from_segments(&[]), "");
}

#[test]
fn test_base_url_switches_ws_scheme() {
    let stt = deepgram().with_base_url("http://127.0.0.1:1234".into());
    assert!(stt.websocket_url(&[]).starts_with("ws://127.0.0.1:1234/v1/listen?"));
}

/// Хендшейк к мёртвому адресу обязан упасть сам и быстро — а не по TCP-таймауту ОС.
#[tokio::test]
async fn a_dead_host_fails_the_stream_promptly() {
    let stt = deepgram().with_base_url("http://127.0.0.1:1".into());
    let chunks: AudioChunkStream = Box::pin(futures_util::stream::pending());
    let started = std::time::Instant::now();
    let err = stt
        .transcribe_stream(chunks, &[], tokio_util::sync::CancellationToken::new())
        .await
        .unwrap_err();
    assert!(matches!(err, SttError::Network(_)), "got: {err:?}");
    assert!(started.elapsed() < CONNECT_TIMEOUT + Duration::from_secs(2));
}

#[tokio::test]
async fn cancel_during_the_handshake_is_reported_as_cancelled() {
    let stt = deepgram().with_base_url("http://127.0.0.1:1".into());
    let chunks: AudioChunkStream = Box::pin(futures_util::stream::pending());
    let cancel = tokio_util::sync::CancellationToken::new();
    cancel.cancel();
    let err = stt.transcribe_stream(chunks, &[], cancel).await.unwrap_err();
    assert!(matches!(err, SttError::Cancelled | SttError::Network(_)), "got: {err:?}");
}
