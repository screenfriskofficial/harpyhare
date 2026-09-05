use super::*;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn test_client(base_url: &str) -> XclisClient {
    let spec = crate::llm::registry::spec(PROVIDER_XCLIS).expect("Xclis provider");
    XclisClient::new(spec, "key".into()).with_base_url(base_url.to_string())
}

fn served_of(ids: &[&str]) -> Vec<String> {
    ids.iter().map(|s| s.to_string()).collect()
}

#[derive(Default)]
struct TestSink {
    text: String,
    input_tokens: Vec<u32>,
}

impl LlmStreamSink for TestSink {
    fn text_delta(&mut self, delta: &str) {
        self.text.push_str(delta);
    }
    fn input_tokens(&mut self, total: u32) {
        self.input_tokens.push(total);
    }
}

fn request(model: &str, thinking: bool) -> LlmRequest {
    LlmRequest {
        model: model.into(),
        system: String::new(),
        messages: vec![ChatMessage { role: "user".into(), text: "q".into(), images: vec![] }],
        options: crate::llm::RequestOptions { thinking, web_search: false },
    }
}

/// Сопоставляет тело пробы по имени модели: обе пробы уходят на один путь.
struct BodyModelIs(&'static str);

impl wiremock::Match for BodyModelIs {
    fn matches(&self, request: &wiremock::Request) -> bool {
        serde_json::from_slice::<Value>(&request.body)
            .ok()
            .and_then(|v| v["model"].as_str().map(str::to_string))
            .is_some_and(|model| model == self.0)
    }
}

const REJECTION_BODY: &str =
    r#"{"error":{"message":"Model \"dead\" is not supported by any configured account in this group"}}"#;
const EMPTY_BODY_ERROR: &str =
    r#"{"error":{"message":"messages: all messages have empty content"}}"#;

#[test]
fn model_ids_are_namespaced_and_thinking_variants_are_hidden() {
    let value = json!({
        "data": [
            {"id": "claude-sonnet-5", "display_name": "Claude Sonnet 5"},
            {"id": "claude-sonnet-5-thinking", "display_name": "Claude Sonnet 5 Thinking"}
        ]
    });
    let served = XclisClient::advertised_ids(&value);
    let models = XclisClient::models_from(&value, &served);
    assert_eq!(models.len(), 1);
    assert_eq!(models[0].id, "xclis/claude-sonnet-5");
    assert_eq!(models[0].provider, PROVIDER_XCLIS);
    assert!(models[0].adaptive);
}

#[test]
fn the_namespace_is_the_offline_ownership_claim() {
    let client = test_client("http://127.0.0.1:1");
    assert!(client.owns_model("xclis/claude-opus-4-6"));
    assert!(client.owns_model("xclis/anything-the-group-serves"));
    assert!(!client.owns_model("claude-opus-4-6"), "чужие модели агрегатор не присваивает");
    assert!(client.known_models().is_empty(), "офлайн-каталог по-прежнему пуст");
}

/// До прихода живого каталога суффикс не дописывается НИКОМУ: вшитый список
/// не знает, какие суффиксные модели завёл вендор для этой группы аккаунта.
/// Проверено живьём: `claude-opus-4-6-thinking` существует, а
/// `claude-sonnet-5-thinking` отдаёт 404 — угадывание здесь стоит запроса
/// в несуществующую модель.
#[test]
fn thinking_suffix_is_not_guessed_before_live_models_arrive() {
    let client = test_client("http://127.0.0.1:1");
    assert_eq!(client.selected_model("xclis/claude-sonnet-5", true), "claude-sonnet-5");
    assert_eq!(client.selected_model("xclis/gpt-5.6-sol", true), "gpt-5.6-sol");
}

/// А пришедший каталог включает суффикс ровно там, где двойник реально есть.
/// Каталог — общий, тот же `Arc`, что держит приложение: пересобранный клиент
/// читает его и не теряет способность рассуждать.
#[test]
fn thinking_suffix_follows_the_shared_catalog() {
    let live_catalog = json!({
        "data": [
            {"id": "claude-opus-4-6", "display_name": "Claude Opus 4.6"},
            {"id": "claude-opus-4-6-thinking", "display_name": "Claude Opus 4.6 Thinking"},
            {"id": "claude-sonnet-5", "display_name": "Claude Sonnet 5"}
        ]
    });
    let served = XclisClient::advertised_ids(&live_catalog);
    let shared: ModelCatalog =
        Arc::new(Mutex::new(XclisClient::models_from(&live_catalog, &served)));
    let client = test_client("http://127.0.0.1:1").with_catalog(Arc::clone(&shared));
    assert_eq!(client.selected_model("xclis/claude-opus-4-6", true), "claude-opus-4-6-thinking");
    assert_eq!(client.selected_model("xclis/claude-sonnet-5", true), "claude-sonnet-5");

    let rebuilt = test_client("http://127.0.0.1:1").with_catalog(shared);
    assert_eq!(
        rebuilt.selected_model("xclis/claude-opus-4-6", true),
        "claude-opus-4-6-thinking",
        "новый клиент над тем же каталогом знает то же самое"
    );
}

/// Каталог вендора перечисляет модели, которых группа не обслуживает —
/// проверено живьём. Отсев идёт бесплатной пробой: шлюз сверяет модель с
/// аккаунтом раньше, чем валидирует тело, поэтому пустой `messages: []`
/// у чужой модели даёт 404 с этим текстом, а у своей — 400 про пустое тело.
#[tokio::test]
async fn advertised_but_unserved_models_are_dropped_from_the_catalog() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(CHAT_COMPLETIONS_PATH))
        .and(BodyModelIs("dead"))
        .respond_with(ResponseTemplate::new(404).set_body_string(REJECTION_BODY))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(CHAT_COMPLETIONS_PATH))
        .respond_with(ResponseTemplate::new(400).set_body_string(EMPTY_BODY_ERROR))
        .mount(&server)
        .await;

    let client = test_client(&server.uri());
    let catalog = json!({"data": [{"id": "alive"}, {"id": "dead"}]});
    let served = client.served_ids(XclisClient::advertised_ids(&catalog)).await;
    let models = XclisClient::models_from(&catalog, &served);
    assert_eq!(models.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["xclis/alive"]);
}

/// Вердикт живёт: второй `list_models` не шлёт ни одной пробы, пока TTL свеж.
#[tokio::test]
async fn probe_verdicts_are_cached_between_catalog_refreshes() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(CHAT_COMPLETIONS_PATH))
        .respond_with(ResponseTemplate::new(400).set_body_string(EMPTY_BODY_ERROR))
        .expect(2)
        .mount(&server)
        .await;

    let client = test_client(&server.uri());
    let advertised = served_of(&["a", "b"]);
    assert_eq!(client.served_ids(advertised.clone()).await, advertised);
    assert_eq!(client.served_ids(advertised.clone()).await, advertised);
    server.verify().await;
}

/// Объявленная, но мёртвая суффиксная модель не должна давать базовой
/// признак «умеет размышлять»: на этом эндпоинте рассуждение включается
/// ТОЛЬКО отдельной моделью — `reasoning_effort` и `thinking` шлюз молча
/// игнорирует (проверено живьём), — поэтому обещание обернулось бы 404.
#[test]
fn thinking_capability_ignores_advertised_but_dead_twins() {
    let catalog = json!({
        "data": [
            {"id": "opus"},
            {"id": "opus-thinking"},
            {"id": "sonnet"},
            {"id": "sonnet-thinking"}
        ]
    });
    // Живыми оказались базовые и только один из двух суффиксных.
    let served = served_of(&["opus", "opus-thinking", "sonnet"]);
    let models = XclisClient::models_from(&catalog, &served);
    let adaptive: Vec<(&str, bool)> =
        models.iter().map(|m| (m.id.as_str(), m.adaptive)).collect();
    assert!(adaptive.contains(&("xclis/opus", true)), "живой двойник — способность есть");
    assert!(adaptive.contains(&("xclis/sonnet", false)), "мёртвый двойник — способности нет");
}

/// Отказ в бою правит общий каталог: мёртвый двойник снимает способность
/// рассуждать с базовой модели, мёртвая базовая исчезает целиком — и оба
/// вердикта запоминаются, чтобы пикер их больше не предлагал.
#[tokio::test]
async fn a_rejection_in_flight_fixes_the_shared_catalog_and_is_remembered() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(CHAT_COMPLETIONS_PATH))
        .respond_with(ResponseTemplate::new(404).set_body_string(REJECTION_BODY))
        .mount(&server)
        .await;
    let live = json!({"data": [{"id": "opus"}, {"id": "opus-thinking"}, {"id": "sonnet"}]});
    let shared: ModelCatalog = Arc::new(Mutex::new(XclisClient::models_from(
        &live,
        &served_of(&["opus", "opus-thinking", "sonnet"]),
    )));
    let client = test_client(&server.uri()).with_catalog(Arc::clone(&shared));

    let err = client
        .stream(request("xclis/opus", true), CancellationToken::new(), &mut TestSink::default())
        .await
        .unwrap_err();
    assert!(matches!(err, LlmError::Api(_)), "got: {err:?}");
    {
        let catalog = shared.lock().unwrap();
        let opus = catalog.iter().find(|m| m.id == "xclis/opus").expect("базовая осталась");
        assert!(!opus.adaptive, "мёртвый двойник снимает способность рассуждать");
    }
    assert_eq!(client.cached_verdict("opus-thinking"), Some(false));

    client
        .stream(request("xclis/sonnet", false), CancellationToken::new(), &mut TestSink::default())
        .await
        .unwrap_err();
    assert!(shared.lock().unwrap().iter().all(|m| m.id != "xclis/sonnet"));
    assert_eq!(
        client.served_ids(served_of(&["sonnet"])).await,
        Vec::<String>::new(),
        "запомненный отказ не перепробуется и не предлагается"
    );
}

/// Сетевой сбой не должен вычищать пикер: одна недоступность сервера хуже
/// лишней строки в списке.
#[tokio::test]
async fn unreachable_vendor_keeps_the_advertised_models() {
    let client = test_client("http://127.0.0.1:1");
    let catalog = json!({"data": [{"id": "alive"}]});
    let served = client.served_ids(XclisClient::advertised_ids(&catalog)).await;
    assert_eq!(XclisClient::models_from(&catalog, &served).len(), 1);
}

#[test]
fn chat_completion_chunks_carry_text_usage_and_a_soft_end() {
    let mut parser = SseParser::with_block_parser(parse_block);
    let events = parser.feed_bytes(
        b"data: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}\r\n\r\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":42}}\r\n\r\ndata: [DONE]\r\n\r\n",
    );
    assert_eq!(
        events,
        vec![
            SseOut::TextDelta("ok".into()),
            SseOut::Finished,
            SseOut::InputTokens(42),
            SseOut::Done(None)
        ]
    );
}

#[test]
fn stream_requests_usage_and_never_web_search() {
    let client = test_client("http://127.0.0.1:1");
    let body = client.chat_body(&request("xclis/opus", false)).unwrap();
    assert_eq!(body["stream_options"]["include_usage"], true);
    assert_eq!(body["model"], "opus");
    let mut with_search = request("xclis/opus", false);
    with_search.options.web_search = true;
    assert!(matches!(client.chat_body(&with_search), Err(LlmError::Api(_))));
}

/// Usage-чанк приходит ПОСЛЕ `finish_reason`: остановка на нём теряла бы
/// токены, а EOF после `finish_reason` без `[DONE]` — штатный конец.
#[tokio::test]
async fn stream_keeps_reading_after_finish_reason_and_accepts_eof_without_done() {
    let server = MockServer::start().await;
    let body = "data: {\"choices\":[{\"delta\":{\"content\":\"При\"},\"finish_reason\":null}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"вет\"},\"finish_reason\":\"stop\"}]}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":7}}\n\n";
    Mock::given(method("POST"))
        .and(path(CHAT_COMPLETIONS_PATH))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "text/event-stream")
                .set_body_raw(body.as_bytes().to_vec(), "text/event-stream"),
        )
        .mount(&server)
        .await;
    let client = test_client(&server.uri());
    let mut sink = TestSink::default();
    client
        .stream(request("xclis/opus", false), CancellationToken::new(), &mut sink)
        .await
        .unwrap();
    assert_eq!(sink.text, "Привет");
    assert_eq!(sink.input_tokens, vec![7]);
}

/// Шлюз иногда игнорирует `stream: true` и отвечает обычным JSON.
#[tokio::test]
async fn a_plain_json_answer_is_delivered_as_one_delta() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(CHAT_COMPLETIONS_PATH))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "choices": [{"message": {"content": "целиком"}}],
            "usage": {"prompt_tokens": 5}
        })))
        .mount(&server)
        .await;
    let client = test_client(&server.uri());
    let mut sink = TestSink::default();
    client
        .stream(request("xclis/opus", false), CancellationToken::new(), &mut sink)
        .await
        .unwrap();
    assert_eq!(sink.text, "целиком");
    assert_eq!(sink.input_tokens, vec![5]);
}

/// «Стоп» на нестриминговом ответе не ждёт всё тело.
#[tokio::test]
async fn cancel_interrupts_a_slow_json_answer() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(CHAT_COMPLETIONS_PATH))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({"choices": [{"message": {"content": "поздно"}}]}))
                .set_delay(Duration::from_secs(5)),
        )
        .mount(&server)
        .await;
    let client = test_client(&server.uri());
    let cancel = CancellationToken::new();
    cancel.cancel();
    let started = Instant::now();
    let err = client
        .stream(request("xclis/opus", false), cancel, &mut TestSink::default())
        .await
        .unwrap_err();
    assert!(matches!(err, LlmError::Cancelled));
    assert!(started.elapsed() < Duration::from_secs(2), "отмена не должна ждать тело");
}

#[tokio::test]
async fn catalog_and_token_counter_use_the_anthropic_shaped_credentials() {
    use wiremock::matchers::header;
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(MODELS_PATH))
        .and(header("x-api-key", "key"))
        .and(header("anthropic-version", "2023-06-01"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"data": [{"id": "opus"}]})))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(CHAT_COMPLETIONS_PATH))
        .respond_with(ResponseTemplate::new(400).set_body_string(EMPTY_BODY_ERROR))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(COUNT_TOKENS_PATH))
        .and(header("x-api-key", "key"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"input_tokens": 12})))
        .mount(&server)
        .await;
    let client = test_client(&server.uri());
    let models = client.list_models().await.unwrap();
    assert_eq!(models.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["xclis/opus"]);
    assert_eq!(client.count_tokens(request("xclis/opus", false)).await.unwrap(), 12);
}
