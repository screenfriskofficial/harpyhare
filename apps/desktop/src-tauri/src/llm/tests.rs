use super::*;
use serde_json::json;

fn adaptive() -> Option<Value> {
    Some(json!({"type": "adaptive"}))
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

#[test]
fn thinking_value_semantics() {
    assert_eq!(
        thinking_value(None, "claude-opus-4-8", true),
        Some(json!({"type": "adaptive"}))
    );
    assert_eq!(
        thinking_value(None, "claude-opus-4-8", false),
        Some(json!({"type": "disabled"}))
    );
    assert_eq!(thinking_value(None, "claude-haiku-4-5", true), None);
    assert_eq!(thinking_value(None, "claude-haiku-4-5", false), None);
    assert_eq!(thinking_value(None, "claude-fable-5", true), None);
    assert_eq!(thinking_value(None, "claude-fable-5", false), None);
    let info = ModelInfo {
        provider: PROVIDER_ANTHROPIC.into(),
        id: "claude-newmodel-9".into(),
        display_name: "New".into(),
        adaptive: false,
        always_thinks: false,
        code_exec: true,
        max_input_tokens: 0,
    };
    assert_eq!(thinking_value(Some(&info), "claude-newmodel-9", true), None);
}

#[test]
fn model_info_parses_capabilities() {
    let v = json!({
        "id": "claude-haiku-4-5-20251001",
        "display_name": "Claude Haiku 4.5",
        "capabilities": {
            "thinking": {"supported": true, "types": {
                "enabled": {"supported": true}, "adaptive": {"supported": false}
            }},
            "code_execution": {"supported": false}
        }
    });
    let m = model_info_from_json(&v).unwrap();
    assert_eq!(m.display_name, "Claude Haiku 4.5");
    assert!(!m.adaptive);
    assert!(!m.always_thinks);
    assert!(!m.code_exec);
    let m = model_info_from_json(&json!({"id": "claude-sonnet-5"})).unwrap();
    assert!(m.adaptive);
    assert!(m.code_exec);
    assert_eq!(m.display_name, "claude-sonnet-5");
}

#[tokio::test]
async fn list_models_fetches_and_parses() {
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/models"))
        .and(header("x-api-key", "sk-test"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": [
                {"id": "claude-sonnet-5", "display_name": "Claude Sonnet 5",
                 "capabilities": {"thinking": {"types": {"adaptive": {"supported": true}}}}},
                {"id": "claude-haiku-4-5-20251001", "display_name": "Claude Haiku 4.5",
                 "capabilities": {"thinking": {"types": {"adaptive": {"supported": false}}}}}
            ]
        })))
        .mount(&server)
        .await;
    let client = AnthropicClient::new("sk-test".into()).with_base_url(server.uri());
    let models = client.list_models().await.unwrap();
    assert_eq!(models.len(), 2);
    assert_eq!(models[0].id, "claude-sonnet-5");
    assert!(models[0].adaptive);
    assert!(!models[1].adaptive);
}

#[test]
fn text_only_content_is_plain_string() {
    assert_eq!(build_content("привет", &[], false), json!("привет"));
}

#[test]
fn images_go_before_text_as_blocks() {
    let imgs = vec![ImageAttachment {
        media_type: "image/png".into(),
        data: "AAAA".into(),
    }];
    assert_eq!(
        build_content("что на скриншоте?", &imgs, false),
        json!([
            {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "AAAA"}},
            {"type": "text", "text": "что на скриншоте?"}
        ])
    );
}

#[test]
fn cache_breakpoint_lands_on_last_block() {
    let content = build_content("вопрос", &[], true);
    assert_eq!(
        content,
        json!([{"type": "text", "text": "вопрос", "cache_control": {"type": "ephemeral"}}])
    );
    let imgs = vec![ImageAttachment { media_type: "image/png".into(), data: "AAAA".into() }];
    let content = build_content("что тут?", &imgs, true);
    let arr = content.as_array().unwrap();
    assert!(arr[0].get("cache_control").is_none());
    assert_eq!(arr[1]["cache_control"]["type"], "ephemeral");
}

#[test]
fn request_body_shape_for_opus_includes_adaptive_thinking() {
    let msgs = vec![ChatMessage {
        role: "user".into(),
        text: "вопрос".into(),
        images: vec![],
    }];
    let body = build_request_body("claude-opus-4-8", "sys", &msgs, adaptive(), None);
    assert_eq!(body["model"], "claude-opus-4-8");
    assert_eq!(body["max_tokens"], 64000);
    assert_eq!(body["stream"], true);
    assert_eq!(body["thinking"]["type"], "adaptive");
    assert_eq!(body["system"][0]["text"], "sys");
    assert_eq!(body["system"][0]["cache_control"]["type"], "ephemeral");
    assert_eq!(body["messages"][0]["role"], "user");
    assert_eq!(body["messages"][0]["content"][0]["text"], "вопрос");
}

#[test]
fn request_body_preserves_multi_turn_history() {
    let msgs = vec![
        ChatMessage { role: "user".into(), text: "1+1?".into(), images: vec![] },
        ChatMessage { role: "assistant".into(), text: "2".into(), images: vec![] },
        ChatMessage { role: "user".into(), text: "а 2+2?".into(), images: vec![] },
    ];
    let body = build_request_body("claude-opus-4-8", "sys", &msgs, adaptive(), None);
    assert_eq!(body["messages"].as_array().unwrap().len(), 3);
    assert_eq!(body["messages"][1]["role"], "assistant");
    assert_eq!(body["messages"][1]["content"], "2");
    assert_eq!(body["messages"][2]["content"][0]["text"], "а 2+2?");
    assert_eq!(
        body["messages"][2]["content"][0]["cache_control"]["type"],
        "ephemeral"
    );
}

#[test]
fn thinking_none_omits_field_entirely() {
    let msgs = vec![ChatMessage { role: "user".into(), text: "q".into(), images: vec![] }];
    let body = build_request_body(
        "claude-haiku-4-5",
        "sys",
        &msgs,
        thinking_value(None, "claude-haiku-4-5", true),
        None,
    );
    assert!(body.get("thinking").is_none());
}

#[test]
fn thinking_off_sends_explicit_disabled() {
    let msgs = vec![ChatMessage { role: "user".into(), text: "q".into(), images: vec![] }];
    let body = build_request_body(
        "claude-opus-4-8",
        "sys",
        &msgs,
        thinking_value(None, "claude-opus-4-8", false),
        None,
    );
    assert_eq!(body["thinking"]["type"], "disabled");
}

#[test]
fn web_search_value_semantics() {
    assert_eq!(web_search_value(None, "claude-opus-4-8", false), None);
    assert_eq!(
        web_search_value(None, "claude-opus-4-8", true),
        Some(json!({"type": "web_search_20260209", "name": "web_search", "max_uses": 5}))
    );
    assert_eq!(
        web_search_value(None, "claude-haiku-4-5", true),
        Some(json!({
            "type": "web_search_20260209", "name": "web_search", "max_uses": 5,
            "allowed_callers": ["direct"]
        }))
    );
    let info = ModelInfo {
        provider: PROVIDER_ANTHROPIC.into(),
        id: "claude-newmodel-9".into(),
        display_name: "New".into(),
        adaptive: true,
        always_thinks: false,
        code_exec: false,
        max_input_tokens: 0,
    };
    let tool = web_search_value(Some(&info), "claude-newmodel-9", true).unwrap();
    assert_eq!(tool["allowed_callers"], json!(["direct"]));
}

#[test]
fn web_search_tool_lands_in_body_tools() {
    let msgs = vec![ChatMessage { role: "user".into(), text: "q".into(), images: vec![] }];
    let tool = web_search_value(None, "claude-opus-4-8", true);
    let body = build_request_body("claude-opus-4-8", "", &msgs, adaptive(), tool);
    assert_eq!(body["tools"][0]["type"], "web_search_20260209");
    assert_eq!(body["tools"][0]["name"], "web_search");
    assert_eq!(body["tools"][0]["max_uses"], 5);
    let body = build_request_body("claude-opus-4-8", "", &msgs, adaptive(), None);
    assert!(body.get("tools").is_none());
}

#[test]
fn empty_messages_are_dropped_from_history() {
    let msgs = vec![
        ChatMessage { role: "user".into(), text: "1+1?".into(), images: vec![] },
        ChatMessage { role: "assistant".into(), text: "".into(), images: vec![] },
        ChatMessage { role: "user".into(), text: "а 2+2?".into(), images: vec![] },
    ];
    let body = build_request_body("claude-opus-4-8", "s", &msgs, adaptive(), None);
    let arr = body["messages"].as_array().unwrap();
    assert_eq!(arr.len(), 2, "пустой assistant выброшен");
    assert_eq!(arr[0]["content"], "1+1?");
    assert_eq!(arr[1]["content"][0]["cache_control"]["type"], "ephemeral");
}

#[test]
fn empty_system_stays_plain_string() {
    let msgs = vec![ChatMessage { role: "user".into(), text: "q".into(), images: vec![] }];
    let body = build_request_body("claude-opus-4-8", "", &msgs, adaptive(), None);
    assert_eq!(body["system"], "");
}

const SSE_FIXTURE: &str = "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_1\"}}\n\nevent: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\nevent: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"При\"}}\n\nevent: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"\"}}\n\nevent: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"вет!\"}}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n";

#[test]
fn sse_parser_extracts_text_deltas_and_done() {
    let mut p = SseParser::anthropic();
    let out = p.feed(SSE_FIXTURE);
    let texts: Vec<_> = out
        .iter()
        .filter_map(|e| match e {
            SseOut::TextDelta(t) => Some(t.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(texts, vec!["При", "вет!"]);
    assert!(matches!(out.last(), Some(SseOut::Done(_))));
}

#[test]
fn sse_parser_handles_chunk_split_mid_event() {
    let mut p = SseParser::anthropic();
    let (a, b) = SSE_FIXTURE.split_at(95);
    let mut out = p.feed(a);
    out.extend(p.feed(b));
    let text: String = out
        .iter()
        .filter_map(|e| match e {
            SseOut::TextDelta(t) => Some(t.clone()),
            _ => None,
        })
        .collect();
    assert_eq!(text, "Привет!");
}

/// Перегрузка приходит СОБЫТИЕМ внутри 200-стрима, не статусом; без этого
/// она уезжала кодом `api` — без кнопки «Повторить» там, где она нужнее всего.
#[test]
fn sse_parser_reports_an_overloaded_event_as_retryable() {
    let mut p = SseParser::anthropic();
    let out = p.feed("event: error\ndata: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}\n\n");
    assert_eq!(out, vec![SseOut::Retryable { code: 529, message: "Overloaded".into() }]);
}

#[test]
fn sse_parser_surfaces_a_non_retryable_api_error_event() {
    let mut p = SseParser::anthropic();
    let out = p.feed("event: error\ndata: {\"type\":\"error\",\"error\":{\"type\":\"invalid_request_error\",\"message\":\"bad\"}}\n\n");
    assert_eq!(out, vec![SseOut::ApiError("bad".into())]);
}

#[test]
fn sse_parser_accepts_crlf_separators_and_data_without_a_space() {
    let mut p = SseParser::anthropic();
    let out = p.feed("event: content_block_delta\r\ndata:{\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"a\"}}\r\n\r\n");
    assert_eq!(out, vec![SseOut::TextDelta("a".into())]);
}

#[test]
fn sse_parser_joins_multiline_data_and_skips_comments() {
    let mut p = SseParser::anthropic();
    let out = p.feed(": keep-alive\ndata: {\"type\":\"content_block_delta\",\ndata: \"delta\":{\"type\":\"text_delta\",\"text\":\"b\"}}\n\n");
    assert_eq!(out, vec![SseOut::TextDelta("b".into())]);
}

#[tokio::test]
async fn stream_ending_after_a_soft_finish_is_a_success() {
    use wiremock::matchers::method;
    use wiremock::{Mock, MockServer, ResponseTemplate};
    fn soft_finish(data: &str) -> Vec<SseOut> {
        match data {
            "end" => vec![SseOut::Finished],
            other => vec![SseOut::TextDelta(other.to_string())],
        }
    }
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "text/event-stream")
                .set_body_raw(b"data: hi\n\ndata: end\n\n".to_vec(), "text/event-stream"),
        )
        .mount(&server)
        .await;
    let http = LlmHttp::direct(server.uri(), Credential::Bearer("k".into()), "T");
    let mut sink = TestSink::default();
    http.post_sse(
        "/x",
        &json!({}),
        SseParser::with_block_parser(soft_finish),
        tokio_util::sync::CancellationToken::new(),
        &mut sink,
    )
    .await
    .unwrap();
    assert_eq!(sink.text, "hi");
}

#[test]
fn empty_text_with_images_has_no_text_block() {
    let imgs = vec![ImageAttachment { media_type: "image/png".into(), data: "AAAA".into() }];
    let content = build_content("", &imgs, false);
    let arr = content.as_array().unwrap();
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["type"], "image");
}

#[test]
fn sse_message_start_usage_summed_with_cache() {
    let mut p = SseParser::anthropic();
    let block = "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":100,\"cache_read_input_tokens\":2000,\"cache_creation_input_tokens\":30}}}\n\n";
    assert_eq!(p.feed(block), vec![SseOut::InputTokens(2130)]);
}

#[test]
fn sse_message_start_without_usage_ignored() {
    let mut p = SseParser::anthropic();
    let block = "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"m\"}}\n\n";
    assert_eq!(p.feed(block), vec![]);
}

#[test]
fn feed_bytes_handles_utf8_split_across_chunks() {
    let raw = "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Привет\"}}\n\n";
    let bytes = raw.as_bytes();
    let cut = raw.find("Привет").unwrap() + 3;
    assert!(std::str::from_utf8(&bytes[..cut]).is_err(), "разрез должен попадать в середину символа");
    let mut p = SseParser::anthropic();
    let mut out = p.feed_bytes(&bytes[..cut]);
    out.extend(p.feed_bytes(&bytes[cut..]));
    assert_eq!(out, vec![SseOut::TextDelta("Привет".to_string())]);
}

#[test]
fn feed_bytes_recovers_from_a_genuinely_invalid_byte() {
    let raw = "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"hi\"}}\n\n";
    let mut p = SseParser::anthropic();
    // Битый байт посреди потока не должен оседать в хвосте навсегда: до фикса
    // парсер после него не отдавал ни одной дельты и стрим выглядел обрывом сети.
    assert!(p.feed_bytes(&[0xFF]).is_empty());
    let out = p.feed_bytes(raw.as_bytes());
    assert_eq!(out, vec![SseOut::TextDelta("hi".to_string())]);
}

#[test]
fn sse_parser_handles_chunk_split_mid_data_json() {
    let raw = "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"hi\"}}\n\n";
    let mid = raw.find("text_delta").unwrap() + 5;
    let mut p = SseParser::anthropic();
    let mut out = p.feed(&raw[..mid]);
    out.extend(p.feed(&raw[mid..]));
    assert_eq!(out, vec![SseOut::TextDelta("hi".to_string())]);
}

#[tokio::test]
async fn stream_collects_deltas_via_callback() {
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/messages"))
        .and(header("x-api-key", "sk-test"))
        .and(header("anthropic-version", "2023-06-01"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "text/event-stream")
                .set_body_raw(SSE_FIXTURE.as_bytes().to_vec(), "text/event-stream"),
        )
        .mount(&server)
        .await;

    let client = AnthropicClient::new("sk-test".into()).with_base_url(server.uri());
    let cancel = tokio_util::sync::CancellationToken::new();
    let msgs = vec![ChatMessage { role: "user".into(), text: "q".into(), images: vec![] }];
    let mut sink = TestSink::default();
    client
        .stream_message(
            build_request_body("claude-opus-4-8", "s", &msgs, adaptive(), None),
            cancel,
            &mut sink,
        )
        .await
        .unwrap();
    assert_eq!(sink.text, "Привет!");
}

#[tokio::test]
async fn stream_times_out_on_silent_server() {
    use wiremock::matchers::method;
    use wiremock::{Mock, MockServer, ResponseTemplate};
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "text/event-stream")
                .set_body_raw(SSE_FIXTURE.as_bytes().to_vec(), "text/event-stream")
                .set_delay(std::time::Duration::from_secs(10)),
        )
        .mount(&server)
        .await;
    let client = AnthropicClient::new("k".into())
        .with_base_url(server.uri())
        .with_read_timeout(std::time::Duration::from_millis(200));
    let msgs = vec![ChatMessage { role: "user".into(), text: "q".into(), images: vec![] }];
    let err = client
        .stream_message(
            build_request_body("claude-opus-4-8", "s", &msgs, adaptive(), None),
            tokio_util::sync::CancellationToken::new(),
            &mut TestSink::default(),
        )
        .await
        .unwrap_err();
    assert!(matches!(err, LlmError::Network(_)), "got: {err:?}");
}

#[tokio::test]
async fn stream_eof_without_message_stop_is_error() {
    use wiremock::matchers::method;
    use wiremock::{Mock, MockServer, ResponseTemplate};
    let server = MockServer::start().await;
    let truncated = "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"При\"}}\n\n";
    Mock::given(method("POST"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "text/event-stream")
                .set_body_raw(truncated.as_bytes().to_vec(), "text/event-stream"),
        )
        .mount(&server)
        .await;
    let client = AnthropicClient::new("k".into()).with_base_url(server.uri());
    let msgs = vec![ChatMessage { role: "user".into(), text: "q".into(), images: vec![] }];
    let mut sink = TestSink::default();
    let err = client
        .stream_message(
            build_request_body("claude-opus-4-8", "s", &msgs, adaptive(), None),
            tokio_util::sync::CancellationToken::new(),
            &mut sink,
        )
        .await
        .unwrap_err();
    assert!(matches!(err, LlmError::Network(_)));
    assert_eq!(sink.text, "При");
}

#[tokio::test]
async fn stream_surfaces_api_error_message_from_body() {
    use wiremock::matchers::method;
    use wiremock::{Mock, MockServer, ResponseTemplate};
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(400).set_body_json(serde_json::json!({
            "type": "error",
            "error": {"type": "invalid_request_error", "message": "Your credit balance is too low"}
        })))
        .mount(&server)
        .await;
    let client = AnthropicClient::new("k".into()).with_base_url(server.uri());
    let msgs = vec![ChatMessage { role: "user".into(), text: "q".into(), images: vec![] }];
    let err = client
        .stream_message(
            build_request_body("claude-opus-4-8", "s", &msgs, adaptive(), None),
            tokio_util::sync::CancellationToken::new(),
            &mut TestSink::default(),
        )
        .await
        .unwrap_err();
    assert!(
        matches!(&err, LlmError::Api(m) if m.contains("credit balance")),
        "got: {err:?}"
    );
}

#[tokio::test]
async fn stream_maps_401() {
    use wiremock::matchers::method;
    use wiremock::{Mock, MockServer, ResponseTemplate};
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(401))
        .mount(&server)
        .await;
    let client = AnthropicClient::new("bad".into()).with_base_url(server.uri());
    let msgs = vec![ChatMessage { role: "user".into(), text: "q".into(), images: vec![] }];
    let err = client
        .stream_message(
            build_request_body("claude-opus-4-8", "s", &msgs, adaptive(), None),
            tokio_util::sync::CancellationToken::new(),
            &mut TestSink::default(),
        )
        .await
        .unwrap_err();
    assert!(matches!(err, LlmError::BadApiKey(_)));
}

#[tokio::test]
async fn proxy_mode_authorizes_with_bearer_not_api_key() {
    use wiremock::matchers::{header, header_exists, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/messages"))
        .and(header("authorization", "Bearer itk_token"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "text/event-stream")
                .set_body_raw(SSE_FIXTURE.as_bytes().to_vec(), "text/event-stream"),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(header_exists("x-api-key"))
        .respond_with(ResponseTemplate::new(500))
        .mount(&server)
        .await;
    let client = llm_proxy_client("itk_token".into(), server.uri());
    let msgs = vec![ChatMessage { role: "user".into(), text: "q".into(), images: vec![] }];
    client
        .stream_message(
            build_request_body("claude-opus-4-8", "s", &msgs, adaptive(), None),
            tokio_util::sync::CancellationToken::new(),
            &mut TestSink::default(),
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn proxy_mode_401_is_a_dead_access_code_with_the_relays_message() {
    use wiremock::matchers::method;
    use wiremock::{Mock, MockServer, ResponseTemplate};
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(401).set_body_json(serde_json::json!({
            "error": {"message": "Код доступа недействителен — введите новый в настройках"}
        })))
        .mount(&server)
        .await;
    let client = llm_proxy_client("itk_bad".into(), server.uri());
    let msgs = vec![ChatMessage { role: "user".into(), text: "q".into(), images: vec![] }];
    let err = client
        .stream_message(
            build_request_body("claude-opus-4-8", "s", &msgs, adaptive(), None),
            tokio_util::sync::CancellationToken::new(),
            &mut TestSink::default(),
        )
        .await
        .unwrap_err();
    assert!(
        matches!(&err, LlmError::BadAccessCode(m) if m.contains("Код доступа недействителен")),
        "got: {err:?}"
    );
}

fn llm_proxy_client(token: String, base: String) -> AnthropicClient {
    AnthropicClient::for_proxy(token, base)
}

#[tokio::test]
async fn stream_cancellation_stops_early() {
    use wiremock::matchers::method;
    use wiremock::{Mock, MockServer, ResponseTemplate};
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "text/event-stream")
                .set_body_raw(SSE_FIXTURE.as_bytes().to_vec(), "text/event-stream")
                .set_delay(std::time::Duration::from_secs(5)),
        )
        .mount(&server)
        .await;
    let client = AnthropicClient::new("k".into()).with_base_url(server.uri());
    let cancel = tokio_util::sync::CancellationToken::new();
    cancel.cancel();
    let msgs = vec![ChatMessage { role: "user".into(), text: "q".into(), images: vec![] }];
    let err = client
        .stream_message(
            build_request_body("claude-opus-4-8", "s", &msgs, adaptive(), None),
            cancel,
            &mut TestSink::default(),
        )
        .await
        .unwrap_err();
    assert!(matches!(err, LlmError::Cancelled));
}

#[tokio::test]
async fn reachable_treats_any_http_status_as_online() {
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/models"))
        .respond_with(ResponseTemplate::new(401))
        .mount(&server)
        .await;
    let client = AnthropicClient::new("k".into()).with_base_url(server.uri());
    assert!(client.reachable().await);
}

#[tokio::test]
async fn reachable_is_false_when_the_host_refuses() {
    let addr = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap();
    let client = AnthropicClient::new("k".into()).with_base_url(format!("http://{addr}"));
    assert!(!client.reachable().await);
}

fn echo_sse_payload(payload: &str) -> Vec<SseOut> {
    vec![SseOut::TextDelta(payload.to_string())]
}

#[test]
fn sse_framing_survives_every_byte_boundary_and_batches_of_events() {
    let source = "data: Привет\r\n\r\ndata: second\n\ndata: third\r\r";
    for chunk_size in 1..=source.len() {
        let mut parser = SseParser::with_block_parser(echo_sse_payload);
        let result: Vec<_> = source.as_bytes().chunks(chunk_size).flat_map(|chunk| parser.feed_bytes(chunk)).collect();
        assert_eq!(result, vec![SseOut::TextDelta("Привет".into()), SseOut::TextDelta("second".into()), SseOut::TextDelta("third".into())], "chunk size {chunk_size}");
    }
    let mut parser = SseParser::with_block_parser(echo_sse_payload);
    let batch = "data: x\n\n".repeat(4096);
    assert_eq!(parser.feed(&batch).len(), 4096);
    assert!(parser.buffer.is_empty());
}

#[test]
fn sse_multiline_payload_preserves_empty_data_lines() {
    let mut parser = SseParser::with_block_parser(echo_sse_payload);
    assert_eq!(parser.feed("data:\ndata: next\ndata:\n\n"), vec![SseOut::TextDelta("\nnext\n".into())]);
}
