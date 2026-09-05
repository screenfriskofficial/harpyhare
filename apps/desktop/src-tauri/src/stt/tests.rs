use super::*;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

// Read from the registry rather than from copies: a vendor whose paths or
// models move should make these tests follow it, not silently keep asserting
// the old wire format against the new client.
fn groq() -> &'static registry::SttProviderSpec {
    registry::spec(registry::PROVIDER_GROQ).expect("groq объявлен в реестре")
}
fn openai() -> &'static registry::SttProviderSpec {
    registry::spec(registry::PROVIDER_OPENAI).expect("openai объявлен в реестре")
}

/// Models of an OpenAI-dialect row, read from the registry so a vendor that
/// moves drags its tests along instead of leaving them on a stale wire format.
fn models_of(spec: &'static registry::SttProviderSpec) -> (&'static str, &'static str) {
    match spec.wire {
        registry::SttWire::OpenAiMultipart { transcribe_model, translation, .. } => {
            (transcribe_model, translation.expect("у тестируемого вендора есть перевод").model)
        }
        registry::SttWire::Xai { .. } | registry::SttWire::Deepgram { .. } => {
            panic!("у этого вендора нет моделей в запросе")
        }
    }
}

const NO_KEYTERMS: Keyterms<'static> = &[];

fn samples() -> Vec<f32> {
    vec![0.1f32; 16000]
}

struct BodyHas(&'static str);
impl wiremock::Match for BodyHas {
    fn matches(&self, request: &wiremock::Request) -> bool {
        String::from_utf8_lossy(&request.body).contains(self.0)
    }
}
struct BodyLacks(&'static str);
impl wiremock::Match for BodyLacks {
    fn matches(&self, request: &wiremock::Request) -> bool {
        !String::from_utf8_lossy(&request.body).contains(self.0)
    }
}
#[tokio::test]
async fn transcribe_returns_text_on_success() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(groq().wire.path(false)))
        .and(header("authorization", "Bearer gsk_test"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"text": "привет мир"})))
        .mount(&server)
        .await;
    let stt = SttHttpClient::for_provider(registry::PROVIDER_GROQ, "gsk_test".into()).with_base_url(server.uri());
    assert_eq!(stt.transcribe(&samples(), NO_KEYTERMS).await.unwrap(), "привет мир");
}

#[tokio::test]
async fn transcribe_sends_language_field_by_default() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(groq().wire.path(false)))
        .and(BodyHas("language"))
        .and(BodyHas("temperature"))
        .and(BodyHas("whisper-large-v3-turbo"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"text": "ок"})))
        .mount(&server)
        .await;
    let stt = SttHttpClient::for_provider(registry::PROVIDER_GROQ, "k".into()).with_base_url(server.uri());
    assert_eq!(stt.transcribe(&samples(), NO_KEYTERMS).await.unwrap(), "ок");
}

#[tokio::test]
async fn empty_language_means_autodetect_field_omitted() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(groq().wire.path(false)))
        .and(BodyLacks("language"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"text": "auto"})))
        .mount(&server)
        .await;
    let stt = SttHttpClient::for_provider(registry::PROVIDER_GROQ, "k".into())
        .with_base_url(server.uri())
        .with_language(String::new());
    assert_eq!(stt.transcribe(&samples(), NO_KEYTERMS).await.unwrap(), "auto");
}

#[tokio::test]
async fn translate_uses_translations_endpoint_and_large_v3() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(groq().wire.path(true)))
        .and(BodyHas("whisper-large-v3"))
        .and(BodyLacks("turbo"))
        .and(BodyLacks("language"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"text": "hello"})))
        .mount(&server)
        .await;
    let stt = SttHttpClient::for_provider(registry::PROVIDER_GROQ, "k".into())
        .with_base_url(server.uri())
        .with_translate(true);
    assert_eq!(stt.transcribe(&samples(), NO_KEYTERMS).await.unwrap(), "hello");
}

#[tokio::test]
async fn openai_transcribe_sends_gpt_4o_mini_with_language_and_no_temperature() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(openai().wire.path(false)))
        .and(header("authorization", "Bearer sk_test"))
        .and(BodyHas(models_of(openai()).0))
        .and(BodyHas("language"))
        .and(BodyLacks("temperature"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"text": "map ок"})))
        .mount(&server)
        .await;
    let stt = SttHttpClient::for_provider(registry::PROVIDER_OPENAI, "sk_test".into()).with_base_url(server.uri());
    assert_eq!(stt.transcribe(&samples(), NO_KEYTERMS).await.unwrap(), "map ок");
}

#[tokio::test]
async fn openai_empty_language_omits_language_field() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(openai().wire.path(false)))
        .and(BodyLacks("language"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"text": "auto"})))
        .mount(&server)
        .await;
    let stt = SttHttpClient::for_provider(registry::PROVIDER_OPENAI, "k".into())
        .with_base_url(server.uri())
        .with_language(String::new());
    assert_eq!(stt.transcribe(&samples(), NO_KEYTERMS).await.unwrap(), "auto");
}

#[tokio::test]
async fn openai_translate_uses_whisper_1_on_translations_endpoint() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(openai().wire.path(true)))
        .and(BodyHas(models_of(openai()).1))
        .and(BodyLacks("language"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"text": "hello"})))
        .mount(&server)
        .await;
    let stt = SttHttpClient::for_provider(registry::PROVIDER_OPENAI, "k".into())
        .with_base_url(server.uri())
        .with_translate(true);
    assert_eq!(stt.transcribe(&samples(), NO_KEYTERMS).await.unwrap(), "hello");
}

#[tokio::test]
async fn openai_401_names_openai_key() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(401))
        .mount(&server)
        .await;
    let stt = SttHttpClient::for_provider(registry::PROVIDER_OPENAI, "bad".into()).with_base_url(server.uri());
    match stt.transcribe(&samples(), NO_KEYTERMS).await {
        Err(SttError::BadApiKey(label)) => assert_eq!(label, openai().key_label),
        other => panic!("ожидался BadApiKey, получено: {other:?}"),
    }
}

#[tokio::test]
async fn transcribe_stream_sends_chunked_body_and_parses_text() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(groq().wire.path(false)))
        .and(header("authorization", "Bearer gsk_test"))
        .and(BodyHas("RIFF"))
        .and(BodyHas("WAVE"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(serde_json::json!({"text": " стрим ок "})),
        )
        .mount(&server)
        .await;
    let stt = SttHttpClient::for_provider(registry::PROVIDER_GROQ, "gsk_test".into()).with_base_url(server.uri());

    // Конвейер отдаёт сырой PCM; WAV-заголовок подшивает сам клиент.
    let chunks: Vec<Result<Vec<u8>, std::io::Error>> = vec![
        Ok(crate::audio::f32_to_i16le_bytes(&vec![0.1f32; 8000])),
        Ok(crate::audio::f32_to_i16le_bytes(&vec![0.2f32; 8000])),
    ];
    let body: AudioChunkStream = Box::pin(futures_util::stream::iter(chunks));
    let text = stt
        .transcribe_stream(body, NO_KEYTERMS, tokio_util::sync::CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(text, "стрим ок");
}

#[tokio::test]
async fn transcribe_stream_cancel_aborts() {
    use futures_util::StreamExt;
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"text": "x"})))
        .mount(&server)
        .await;
    let stt = SttHttpClient::for_provider(registry::PROVIDER_GROQ, "k".into()).with_base_url(server.uri());
    let endless =
        futures_util::stream::repeat_with(|| Ok::<Vec<u8>, std::io::Error>(vec![0u8; 512]))
            .then(|c| async {
                tokio::time::sleep(std::time::Duration::from_millis(5)).await;
                c
            });
    let cancel = tokio_util::sync::CancellationToken::new();
    let c2 = cancel.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        c2.cancel();
    });
    let err = stt
        .transcribe_stream(Box::pin(endless), NO_KEYTERMS, cancel)
        .await
        .unwrap_err();
    assert!(matches!(err, SttError::Cancelled));
}

#[tokio::test]
async fn transcribe_maps_401_to_bad_key() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(401))
        .mount(&server)
        .await;
    let stt = SttHttpClient::for_provider(registry::PROVIDER_GROQ, "bad".into()).with_base_url(server.uri());
    match stt.transcribe(&samples(), NO_KEYTERMS).await {
        Err(SttError::BadApiKey(label)) => assert_eq!(label, groq().key_label),
        other => panic!("ожидался BadApiKey, получено: {other:?}"),
    }
}

#[tokio::test]
async fn proxy_mode_401_maps_to_bad_access_code_with_body_message() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(401).set_body_json(serde_json::json!({
            "error": {"message": "Код доступа недействителен — введите новый в настройках"}
        })))
        .mount(&server)
        .await;
    let stt = SttHttpClient::for_provider(registry::PROVIDER_GROQ, "itk_bad".into())
        .with_base_url(server.uri())
        .with_proxy(true);
    match stt.transcribe(&samples(), NO_KEYTERMS).await {
        Err(SttError::BadAccessCode(m)) => assert!(m.contains("Код доступа недействителен")),
        other => panic!("ожидался BadAccessCode, получено: {other:?}"),
    }
}

#[tokio::test]
async fn transcribe_maps_429_and_5xx_to_retryable() {
    for code in [429u16, 500, 503] {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(code))
            .mount(&server)
            .await;
        let stt = SttHttpClient::for_provider(registry::PROVIDER_GROQ, "k".into()).with_base_url(server.uri());
        assert!(matches!(stt.transcribe(&samples(), NO_KEYTERMS).await, Err(SttError::Retryable(_))));
    }
}

#[tokio::test]
async fn transcribe_200_without_text_field_is_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"unexpected": true})))
        .mount(&server)
        .await;
    let stt = SttHttpClient::for_provider(registry::PROVIDER_GROQ, "k".into()).with_base_url(server.uri());
    assert!(matches!(stt.transcribe(&samples(), NO_KEYTERMS).await, Err(SttError::Other(_))));
}

/// Таймаут при живой сети — «сервер не успел», а не «нет соединения»: второе
/// поднимает во фронте оверлей связи, хотя сеть в порядке.
#[tokio::test]
async fn transcribe_maps_timeout_to_retryable() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_delay(std::time::Duration::from_secs(3)))
        .mount(&server)
        .await;
    let stt = SttHttpClient::for_provider(registry::PROVIDER_GROQ, "k".into())
        .with_base_url(server.uri())
        .with_timeout(std::time::Duration::from_millis(200));
    assert!(matches!(stt.transcribe(&samples(), NO_KEYTERMS).await, Err(SttError::Retryable(_))));
}

#[test]
fn the_batch_timeout_grows_with_the_recording() {
    let stt = SttHttpClient::for_provider(registry::PROVIDER_GROQ, "k".into());
    let short = stt.batch_timeout(crate::audio::TARGET_SAMPLE_RATE as usize);
    let long = stt.batch_timeout(crate::audio::TARGET_SAMPLE_RATE as usize * 600);
    assert_eq!(short, DEFAULT_REQUEST_TIMEOUT + std::time::Duration::from_secs(1));
    assert_eq!(long, DEFAULT_REQUEST_TIMEOUT + std::time::Duration::from_secs(600));
}

#[tokio::test]
async fn a_deepgram_row_is_refused_by_the_multipart_client_without_panicking() {
    let stt = SttHttpClient::for_provider(registry::PROVIDER_DEEPGRAM, "k".into());
    assert!(matches!(stt.transcribe(&samples(), NO_KEYTERMS).await, Err(SttError::Other(_))));
}

fn xai() -> &'static registry::SttProviderSpec {
    registry::spec(registry::PROVIDER_XAI).expect("xai объявлен в реестре")
}

/// The audio part must be the LAST field of the body — xAI rejects a body that
/// leads with it, and the app streams that part while the user is still
/// talking, so getting the order wrong breaks every recording.
struct FilePartIsLast;
impl wiremock::Match for FilePartIsLast {
    fn matches(&self, request: &wiremock::Request) -> bool {
        // `; name="` and not `name="`: the file part header also carries
        // `filename="`, which contains `name="` and would match inside itself.
        let body = String::from_utf8_lossy(&request.body);
        match (body.find("; name=\"file\""), body.rfind("; name=\"")) {
            (Some(file_at), Some(last_at)) => file_at == last_at,
            _ => false,
        }
    }
}

#[tokio::test]
async fn xai_posts_to_its_own_endpoint_with_the_audio_part_last() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(xai().wire.path(false)))
        .and(BodyHas("name=\"language\""))
        .and(FilePartIsLast)
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"text": "привет"})))
        .mount(&server)
        .await;

    let stt = SttHttpClient::for_provider(registry::PROVIDER_XAI, "xai-key".into())
        .with_base_url(server.uri());
    assert_eq!(stt.transcribe(&samples(), NO_KEYTERMS).await.unwrap(), "привет");
}

#[tokio::test]
async fn xai_sends_no_model_field_because_there_is_nothing_to_choose() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(xai().wire.path(false)))
        .and(BodyLacks("name=\"model\""))
        .and(BodyLacks("name=\"response_format\""))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"text": "ок"})))
        .mount(&server)
        .await;

    let stt = SttHttpClient::for_provider(registry::PROVIDER_XAI, "xai-key".into())
        .with_base_url(server.uri());
    assert_eq!(stt.transcribe(&samples(), NO_KEYTERMS).await.unwrap(), "ок");
}

#[tokio::test]
async fn xai_ignores_translate_and_keeps_transcribing_with_the_language_asked_for() {
    // The vendor has no translations endpoint. The launcher greys the toggle
    // out, but a value stored earlier must not silently change the endpoint.
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(xai().wire.path(false)))
        .and(BodyHas("ru"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"text": "да"})))
        .mount(&server)
        .await;

    let stt = SttHttpClient::for_provider(registry::PROVIDER_XAI, "xai-key".into())
        .with_base_url(server.uri())
        .with_language("ru".into())
        .with_translate(true);
    assert_eq!(stt.transcribe(&samples(), NO_KEYTERMS).await.unwrap(), "да");
}

#[tokio::test]
async fn xai_401_names_the_xai_key() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(xai().wire.path(false)))
        .respond_with(ResponseTemplate::new(401))
        .mount(&server)
        .await;

    let stt = SttHttpClient::for_provider(registry::PROVIDER_XAI, "bad".into())
        .with_base_url(server.uri());
    let err = stt.transcribe(&samples(), NO_KEYTERMS).await.unwrap_err();
    assert!(matches!(err, SttError::BadApiKey(label) if label == xai().key_label));
}

fn terms(n: usize) -> Vec<String> {
    (0..n).map(|i| format!("term{i}")).collect()
}

#[tokio::test]
async fn xai_sends_each_declared_term_as_its_own_keyterm_field() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(xai().wire.path(false)))
        .and(BodyHas("name=\"keyterm\""))
        .and(BodyHas("golang"))
        .and(BodyHas("gRPC"))
        .and(FilePartIsLast)
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"text": "ок"})))
        .mount(&server)
        .await;

    let stt = SttHttpClient::for_provider(registry::PROVIDER_XAI, "k".into())
        .with_base_url(server.uri());
    let declared = vec!["golang".to_string(), "gRPC".to_string()];
    assert_eq!(stt.transcribe(&samples(), &declared).await.unwrap(), "ок");
}

#[tokio::test]
async fn terms_beyond_the_vendor_cap_are_dropped_rather_than_sent() {
    // xAI answers 400 «Too many keyterms» instead of truncating, so exceeding
    // the cap would break every recording rather than degrade one.
    let registry::SttKeyterms::Repeated { max, .. } = xai().keyterms else {
        panic!("у xai объявлен повторяемый keyterm");
    };
    let declared = terms(max + 25);
    assert_eq!(xai().keyterms.accepted(&declared).len(), max);
}

#[tokio::test]
async fn groq_folds_terms_into_one_prompt_field() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(groq().wire.path(false)))
        .and(BodyHas("name=\"prompt\""))
        .and(BodyHas("golang, gRPC"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"text": "ок"})))
        .mount(&server)
        .await;

    let stt = SttHttpClient::for_provider(registry::PROVIDER_GROQ, "k".into())
        .with_base_url(server.uri());
    let declared = vec!["golang".to_string(), "gRPC".to_string()];
    assert_eq!(stt.transcribe(&samples(), &declared).await.unwrap(), "ок");
}

#[tokio::test]
async fn a_vendor_that_ignores_terms_is_not_sent_any() {
    // gpt-4o-mini-transcribe accepts `prompt` and measurably ignores it; sending
    // it anyway would suggest the feature works where it does not.
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(openai().wire.path(false)))
        .and(BodyLacks("name=\"prompt\""))
        .and(BodyLacks("name=\"keyterm\""))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"text": "ок"})))
        .mount(&server)
        .await;

    let stt = SttHttpClient::for_provider(registry::PROVIDER_OPENAI, "k".into())
        .with_base_url(server.uri());
    let declared = vec!["golang".to_string()];
    assert_eq!(stt.transcribe(&samples(), &declared).await.unwrap(), "ок");
}

#[tokio::test]
async fn no_declared_terms_means_no_extra_fields_anywhere() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(xai().wire.path(false)))
        .and(BodyLacks("name=\"keyterm\""))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"text": "ок"})))
        .mount(&server)
        .await;

    let stt = SttHttpClient::for_provider(registry::PROVIDER_XAI, "k".into())
        .with_base_url(server.uri());
    assert_eq!(stt.transcribe(&samples(), NO_KEYTERMS).await.unwrap(), "ок");
}

/// Настоящий предел Deepgram — 500 токенов на все термины разом, а не их число,
/// посчитать его на клиенте нечем. Берём документированный потолок рекомендации
/// вендора (20–50 терминов): он заведомо внутри лимита и режется тем же
/// `accepted()`, что и у остальных вендоров.
#[test]
fn deepgram_caps_keyterms_like_every_other_vendor() {
    let spec = registry::resolve(registry::PROVIDER_DEEPGRAM);
    let registry::SttKeyterms::Repeated { field, max } = spec.keyterms else {
        panic!("Deepgram принимает повторяющийся keyterm");
    };
    assert_eq!(field, "keyterm");
    let many: Vec<String> = (0..max + 10).map(|i| format!("термин{i}")).collect();
    assert_eq!(spec.keyterms.accepted(&many).len(), max);
}
