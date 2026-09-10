use super::*;
use crate::llm::{ImageAttachment, RequestOptions};
use wiremock::matchers::{header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn client(url: &str) -> OpenRouterClient {
    OpenRouterClient::new(
        super::super::registry::spec(PROVIDER_OPENROUTER).unwrap(),
        "test-key".into(),
    )
    .with_base_url(url.into())
}

fn model(id: &str) -> Value {
    json!({
        "id": id, "name": format!("Model {id}"), "context_length": 128000,
        "architecture": {"input_modalities": ["text", "image"], "output_modalities": ["text"]},
        "top_provider": {"max_completion_tokens": 4096},
        "supported_parameters": ["reasoning"],
        "reasoning": {"mandatory": false, "supported_efforts": ["high", "low"], "default_effort": "low"}
    })
}

fn request() -> LlmRequest {
    LlmRequest {
        model: "openrouter/vendor/model".into(),
        system: "Be concise".into(),
        messages: vec![ChatMessage {
            role: "user".into(),
            text: "Hello".into(),
            images: vec![],
        }],
        options: RequestOptions {
            thinking: true,
            web_search: false,
        },
    }
}

#[derive(Default)]
struct Sink {
    text: String,
    tokens: u32,
}
impl LlmStreamSink for Sink {
    fn text_delta(&mut self, text: &str) {
        self.text.push_str(text);
    }
    fn input_tokens(&mut self, tokens: u32) {
        self.tokens = tokens;
    }
}

async fn serve_catalog(server: &MockServer, data: Value) {
    Mock::given(method("GET"))
        .and(path("/v1/models"))
        .and(query_param("output_modalities", "text"))
        .and(header("authorization", "Bearer test-key"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"data": data})))
        .mount(server)
        .await;
}

#[tokio::test]
async fn live_catalog_filters_modalities_namespaces_and_deduplicates() {
    let server = MockServer::start().await;
    let mut voice = model("vendor/transcriber");
    voice["architecture"] =
        json!({"input_modalities": ["audio"], "output_modalities": ["transcription"]});
    let mut image = model("vendor/image-only");
    image["architecture"]["output_modalities"] = json!(["image"]);
    serve_catalog(
        &server,
        json!([
            model("vendor/b"),
            voice,
            image,
            model("vendor/a"),
            model("vendor/a")
        ]),
    )
    .await;
    let client = client(&server.uri());
    let models = client.list_models().await.unwrap();
    assert_eq!(
        models.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
        ["openrouter/vendor/a", "openrouter/vendor/b"]
    );
    assert_eq!(models[0].provider, PROVIDER_OPENROUTER);
    assert_eq!(models[0].max_input_tokens, 128000);
    assert!(models[0].adaptive);
    assert!(!models[0].code_exec);
    assert!(client.owns_model("openrouter/vendor/unlisted"));
    assert!(!client.owns_model("vendor/a"));
    assert!(client.known_models().is_empty());
}

#[test]
fn capabilities_control_reasoning_without_guessing_model_names() {
    let mut value = model("vendor/model");
    let entry = catalog_entry(&value).unwrap();
    assert_eq!(
        reasoning_value(&entry, true),
        Some(json!({"enabled": true, "exclude": true, "effort": "low"}))
    );
    assert_eq!(
        reasoning_value(&entry, false),
        Some(json!({"enabled": false, "exclude": true}))
    );
    value["reasoning"] = json!({"mandatory": true});
    let mandatory = catalog_entry(&value).unwrap();
    assert!(mandatory.info.always_thinks);
    assert!(!mandatory.info.adaptive);
    assert_eq!(
        reasoning_value(&mandatory, false),
        Some(json!({"exclude": true}))
    );
    value["reasoning"] = Value::Null;
    value["supported_parameters"] = json!([]);
    assert_eq!(reasoning_value(&catalog_entry(&value).unwrap(), true), None);
    value["context_length"] = json!(u64::MAX);
    assert_eq!(catalog_entry(&value).unwrap().info.max_input_tokens, 0);
}

#[test]
fn body_preserves_history_images_and_maps_only_supported_options() {
    let mut request = request();
    request.options.web_search = true;
    request.messages.push(ChatMessage {
        role: "assistant".into(),
        text: "Previous answer".into(),
        images: vec![],
    });
    request.messages.push(ChatMessage {
        role: "user".into(),
        text: String::new(),
        images: vec![ImageAttachment {
            media_type: "image/png".into(),
            data: "aGVsbG8=".into(),
        }],
    });
    request.messages.push(ChatMessage {
        role: "user".into(),
        text: String::new(),
        images: vec![],
    });
    let entry = catalog_entry(&model("vendor/model")).unwrap();
    let body = request_body(&request, Some(&entry)).unwrap();
    assert_eq!(body["model"], "vendor/model");
    assert_eq!(body["messages"].as_array().unwrap().len(), 4);
    assert_eq!(
        body["messages"][0],
        json!({"role": "system", "content": "Be concise"})
    );
    assert_eq!(body["messages"][2]["role"], "assistant");
    assert_eq!(
        body["messages"][3]["content"][0]["image_url"]["url"],
        "data:image/png;base64,aGVsbG8="
    );
    assert_eq!(body["max_tokens"], 4096);
    assert_eq!(body["plugins"], json!([{"id": "web"}]));
    let mut text_only = entry;
    text_only.images = false;
    assert!(
        matches!(request_body(&request, Some(&text_only)), Err(LlmError::Api(message)) if message.contains("images"))
    );
    let unknown = request_body(&request, None).unwrap();
    assert!(unknown.get("reasoning").is_none());
    assert!(unknown.get("max_tokens").is_none());
}

#[tokio::test]
async fn streaming_answers_include_late_usage_and_ignore_reasoning() {
    let server = MockServer::start().await;
    serve_catalog(&server, json!([model("vendor/model")])).await;
    let chunks = concat!(
        ": OPENROUTER PROCESSING\n\n",
        "data: {\"choices\":[{\"delta\":{\"reasoning\":\"hidden\"}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\"Привет\"},\"finish_reason\":null}]}\n\n",
        "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\"\"},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":42}}\n\n",
        "data: [DONE]\n\n"
    );
    Mock::given(method("POST"))
        .and(path(CHAT_PATH))
        .and(header("authorization", "Bearer test-key"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(chunks, "text/event-stream"))
        .mount(&server)
        .await;
    let client = client(&server.uri());
    let mut sink = Sink::default();
    client
        .stream(request(), CancellationToken::new(), &mut sink)
        .await
        .unwrap();
    assert_eq!(sink.text, "Привет");
    assert_eq!(sink.tokens, 42);
    let requests = server.received_requests().await.unwrap();
    let body: Value = requests
        .iter()
        .find(|r| r.method.as_str() == "POST")
        .unwrap()
        .body_json()
        .unwrap();
    assert_eq!(body["model"], "vendor/model");
    assert_eq!(body["reasoning"]["effort"], "low");
    assert_eq!(
        client.count_tokens(request()).await.unwrap(),
        UNKNOWN_TOKEN_COUNT
    );
    assert_eq!(
        server.received_requests().await.unwrap().len(),
        requests.len(),
        "token count never makes a paid request"
    );
}

#[test]
fn errors_inside_http_200_are_failures_not_successful_finishes() {
    for code in [
        serde_json::json!(402),
        serde_json::json!("insufficient_quota"),
    ] {
        let event = serde_json::json!({"error": {"code": code, "message": "credits exhausted"}});
        assert!(
            matches!(&parse_block(&event.to_string())[0], SseOut::HttpError(error) if error.code == crate::error::ErrorCode::Billing)
        );
    }
    assert!(matches!(
        parse_block(r#"{"error":{"code":429,"message":"rate limited"}}"#)[0],
        SseOut::Retryable { code: 429, .. }
    ));
    assert!(matches!(
        parse_block(r#"{"error":{"code":"server_error","message":"disconnected"}}"#)[0],
        SseOut::Retryable { code: 500, .. }
    ));
    for reason in ["length", "content_filter", "error", "tool_calls"] {
        assert!(matches!(
            parse_block(&json!({"choices": [{"finish_reason": reason}]}).to_string())[0],
            SseOut::ApiError(_)
        ));
    }
    assert!(matches!(parse_block("broken JSON")[0], SseOut::ApiError(_)));
}

#[tokio::test]
async fn incomplete_and_empty_streams_fail_and_stop_cancels() {
    for (body, is_network) in [
        (
            "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n",
            true,
        ),
        ("data: [DONE]\n\n", false),
    ] {
        let server = MockServer::start().await;
        serve_catalog(&server, json!([model("vendor/model")])).await;
        Mock::given(method("POST"))
            .and(path(CHAT_PATH))
            .respond_with(ResponseTemplate::new(200).set_body_raw(body, "text/event-stream"))
            .mount(&server)
            .await;
        let result = client(&server.uri())
            .stream(request(), CancellationToken::new(), &mut Sink::default())
            .await;
        if is_network {
            assert!(matches!(result, Err(LlmError::Network(_))));
        } else {
            assert!(matches!(result, Err(LlmError::Api(_))));
        }
    }
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(200).set_delay(std::time::Duration::from_secs(5)))
        .mount(&server)
        .await;
    let cancel = CancellationToken::new();
    cancel.cancel();
    let result = client(&server.uri())
        .stream(request(), cancel, &mut Sink::default())
        .await;
    assert!(matches!(result, Err(LlmError::Cancelled)));
}

#[tokio::test]
async fn catalogue_failure_keeps_previous_capabilities() {
    let server = MockServer::start().await;
    serve_catalog(&server, json!([model("vendor/model")])).await;
    let client = client(&server.uri());
    client.list_models().await.unwrap();
    server.reset().await;
    serve_catalog(&server, json!([])).await;
    assert!(client.list_models().await.is_err());
    assert_eq!(client.catalogue.lock_unpoisoned().len(), 1);
}

#[test]
fn registry_requires_own_key_and_does_not_promise_offline_models() {
    let spec = super::super::registry::spec(PROVIDER_OPENROUTER).unwrap();
    assert!(!spec.proxied);
    assert_eq!(spec.key_id, "openrouter");
    assert!(spec.catalog.is_empty());
    assert!(spec.default_model.is_empty());
}

#[tokio::test]
async fn stop_interrupts_an_in_flight_completion() {
    let server = MockServer::start().await;
    serve_catalog(&server, json!([model("vendor/model")])).await;
    Mock::given(method("POST"))
        .and(path(CHAT_PATH))
        .respond_with(ResponseTemplate::new(200).set_delay(std::time::Duration::from_secs(5)))
        .mount(&server)
        .await;
    let client = client(&server.uri());
    client.list_models().await.unwrap();
    let cancel = CancellationToken::new();
    let mut sink = Sink::default();
    let pending = client.stream(request(), cancel.clone(), &mut sink);
    let stop = async {
        loop {
            if server
                .received_requests()
                .await
                .unwrap()
                .iter()
                .any(|r| r.method.as_str() == "POST")
            {
                cancel.cancel();
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
    };
    let (result, ()) = tokio::time::timeout(std::time::Duration::from_secs(2), async {
        tokio::join!(pending, stop)
    })
    .await
    .unwrap();
    assert!(matches!(result, Err(LlmError::Cancelled)));
}

#[tokio::test]
async fn a_saved_model_can_answer_when_the_catalogue_is_down() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(503))
        .mount(&server)
        .await;
    let stream = "data: {\"choices\":[{\"delta\":{\"content\":\"OK\"}}]}\n\ndata: [DONE]\n\n";
    Mock::given(method("POST"))
        .and(path(CHAT_PATH))
        .respond_with(ResponseTemplate::new(200).set_body_raw(stream, "text/event-stream"))
        .mount(&server)
        .await;
    let mut sink = Sink::default();
    client(&server.uri())
        .stream(request(), CancellationToken::new(), &mut sink)
        .await
        .unwrap();
    assert_eq!(sink.text, "OK");
}
