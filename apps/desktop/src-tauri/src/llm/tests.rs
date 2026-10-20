use super::test_support::{assistant, user, CollectingSink};
use super::*;
use serde_json::json;

#[test]
fn anthropic_incomplete_stop_reasons_are_incomplete_answers() {
    for reason in [
        "max_tokens",
        "model_context_window_exceeded",
        "refusal",
        "pause_turn",
        "tool_use",
    ] {
        let event = json!({"type": "message_delta", "delta": {"stop_reason": reason}});
        assert_eq!(
            parse_anthropic_block(&event.to_string()),
            vec![SseOut::Incomplete(format!("Anthropic: {reason}"))],
            "reason: {reason}"
        );
    }
    for reason in ["end_turn", "stop_sequence"] {
        let event = json!({"type": "message_delta", "delta": {"stop_reason": reason}});
        assert!(parse_anthropic_block(&event.to_string()).is_empty());
    }
}

fn adaptive() -> Option<Value> {
    Some(json!({"type": "adaptive"}))
}

/// `/v1/models` as it answered on 2026-10-20, trimmed to what reasoning reads.
fn live(id: &str, thinking: Value, efforts: &[&str]) -> ModelInfo {
    let effort: serde_json::Map<String, Value> = efforts
        .iter()
        .map(|e| (e.to_string(), json!({"supported": true})))
        .collect();
    model_info_from_json(&json!({
        "id": id,
        "capabilities": {"thinking": {"types": thinking}, "effort": effort}
    }))
    .unwrap()
}

const EVERY_LEVEL: [&str; 5] = ["low", "medium", "high", "xhigh", "max"];

fn opus_5_5() -> ModelInfo {
    live(
        "claude-opus-5-5",
        json!({"adaptive": {"supported": true}, "disabled": {"supported": false},
               "enabled": {"supported": false}}),
        &EVERY_LEVEL,
    )
}

fn haiku_4_5() -> ModelInfo {
    live(
        "claude-haiku-4-5-20251001",
        json!({"adaptive": {"supported": false}, "disabled": {"supported": true},
               "enabled": {"supported": true}}),
        &[],
    )
}

#[test]
fn a_model_with_levels_always_reasons_like_on_claude_ai() {
    // claude.ai offers Opus 5.5, Haiku 5.5 and the rest Low…Max and nothing
    // else — no «off», even where the API would take `disabled`.
    for (id, disabled) in [
        ("claude-opus-5-5", false),
        ("claude-haiku-5-5", true),
        ("claude-fable-5-1", false),
    ] {
        let m = live(
            id,
            json!({"adaptive": {"supported": true}, "disabled": {"supported": disabled}}),
            &EVERY_LEVEL,
        );
        assert!(m.always_thinks, "{id}");
        assert_eq!(thinking_value(Some(&m), id, false), adaptive(), "{id}");
        assert_eq!(thinking_value(Some(&m), id, true), adaptive(), "{id}");
    }
}

#[test]
fn disabled_is_never_sent() {
    for m in [opus_5_5(), haiku_4_5()] {
        for requested in [false, true] {
            let thinking = thinking_value(Some(&m), &m.id, requested);
            assert_ne!(thinking, Some(json!({"type": "disabled"})), "{}", m.id);
        }
    }
    assert_eq!(thinking_value(None, "claude-opus-4-8", false), None);
}

#[test]
fn a_budget_model_is_a_switch_with_extended_thinking_behind_it() {
    // claude.ai: Haiku 4.5 → «Extended — Always uses deep reasoning», a toggle.
    let haiku = haiku_4_5();
    assert!(haiku.budget_thinking && !haiku.adaptive && !haiku.always_thinks);
    assert!(haiku.efforts.is_empty() && haiku.default_effort.is_none());
    assert_eq!(thinking_value(Some(&haiku), &haiku.id, false), None);
    assert_eq!(
        thinking_value(Some(&haiku), &haiku.id, true),
        Some(json!({"type": "enabled", "budget_tokens": THINKING_BUDGET_TOKENS}))
    );
}

#[test]
fn a_model_that_does_not_reason_gets_no_thinking_field() {
    let plain = live(
        "claude-newmodel-9",
        json!({"adaptive": {"supported": false}, "enabled": {"supported": false}}),
        &[],
    );
    assert!(!plain.always_thinks);
    assert_eq!(thinking_value(Some(&plain), &plain.id, true), None);
}

#[test]
fn the_default_level_is_the_documented_one() {
    assert_eq!(opus_5_5().default_effort, Some(Effort::Medium));
    let sonnet = live(
        "claude-sonnet-5-5",
        json!({"adaptive": {"supported": true}}),
        &EVERY_LEVEL,
    );
    assert_eq!(sonnet.default_effort, Some(Effort::High));
    // A model the offline table does not know: the API's own default, `high`.
    let opus_4_7 = live(
        "claude-opus-4-7",
        json!({"adaptive": {"supported": true}}),
        &EVERY_LEVEL,
    );
    assert_eq!(opus_4_7.default_effort, Some(Effort::High));
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
    assert!(m.budget_thinking);
    assert!(!m.always_thinks);
    assert!(!m.code_exec);
    assert!(m.efforts.is_empty());
    let m = model_info_from_json(&json!({"id": "claude-sonnet-5"})).unwrap();
    assert!(m.adaptive);
    assert!(m.code_exec);
    assert_eq!(m.display_name, "claude-sonnet-5");
}

#[test]
fn effort_levels_come_from_capabilities_one_by_one() {
    // Opus 4.6 as the live catalogue reports it: no `xhigh`.
    let v = json!({
        "id": "claude-opus-4-6",
        "capabilities": {"effort": {
            "supported": true,
            "low": {"supported": true}, "medium": {"supported": true},
            "high": {"supported": true}, "xhigh": {"supported": false},
            "max": {"supported": true}
        }}
    });
    assert_eq!(
        model_info_from_json(&v).unwrap().efforts,
        [Effort::Low, Effort::Medium, Effort::High, Effort::Max]
    );
}

fn with_effort(thinking: bool, effort: Effort) -> RequestOptions {
    RequestOptions {
        thinking,
        web_search: false,
        effort: Some(effort),
    }
}

#[test]
fn the_chosen_level_is_sent_and_without_one_the_default_is() {
    let opus = opus_5_5();
    assert_eq!(
        effort_config_value(Some(&opus), &opus.id, &with_effort(false, Effort::Xhigh)),
        Some(json!({"effort": "xhigh"})),
        "уровень — единственный контрол, тумблер ему не мешает"
    );
    // What the picker shows checked when the chat picked nothing.
    assert_eq!(
        effort_config_value(Some(&opus), &opus.id, &RequestOptions::default()),
        Some(json!({"effort": "medium"}))
    );
}

#[test]
fn a_level_the_model_does_not_take_falls_back_to_its_default() {
    // Sonnet 4.6 as the live catalogue reports it: no `xhigh`.
    let sonnet = live(
        "claude-sonnet-4-6",
        json!({"adaptive": {"supported": true}, "disabled": {"supported": true}}),
        &["low", "medium", "high", "max"],
    );
    assert_eq!(
        effort_config_value(Some(&sonnet), &sonnet.id, &with_effort(true, Effort::Xhigh)),
        Some(json!({"effort": "high"}))
    );
}

#[test]
fn a_budget_model_never_gets_a_level() {
    let haiku = haiku_4_5();
    assert_eq!(
        effort_config_value(Some(&haiku), &haiku.id, &with_effort(true, Effort::High)),
        None
    );
}

#[test]
fn without_a_live_catalogue_the_offline_one_vouches_for_the_level() {
    assert_eq!(
        effort_config_value(None, "claude-opus-5-5", &with_effort(true, Effort::Xhigh)),
        Some(json!({"effort": "xhigh"}))
    );
    assert_eq!(
        effort_config_value(None, DEFAULT_MODEL, &with_effort(true, Effort::Low)),
        None,
        "Haiku 4.5 — рассуждение с бюджетом, уровней у неё нет"
    );
    assert_eq!(
        effort_config_value(None, "claude-unknown-9", &with_effort(true, Effort::Low)),
        None
    );
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
    let imgs = vec![ImageAttachment {
        media_type: "image/png".into(),
        data: "AAAA".into(),
    }];
    let content = build_content("что тут?", &imgs, true);
    let arr = content.as_array().unwrap();
    assert!(arr[0].get("cache_control").is_none());
    assert_eq!(arr[1]["cache_control"]["type"], "ephemeral");
}

#[test]
fn request_body_shape_for_opus_includes_adaptive_thinking() {
    let msgs = vec![user("вопрос")];
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
    let msgs = vec![user("1+1?"), assistant("2"), user("а 2+2?")];
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
    let msgs = vec![user("q")];
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
fn reasoning_lands_in_the_body_as_adaptive() {
    let msgs = vec![user("q")];
    let opus = opus_5_5();
    let body = build_request_body(
        &opus.id,
        "sys",
        &msgs,
        thinking_value(Some(&opus), &opus.id, false),
        None,
    );
    assert_eq!(body["thinking"]["type"], "adaptive");
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
        Some(json!({"type": "web_search_20250305", "name": "web_search", "max_uses": 5}))
    );
    // The live catalogue reports code execution for Haiku 4.5: that must not
    // earn it the dynamic tool, which it can only call with `allowed_callers`.
    let live_haiku = model_info_from_json(&json!({
        "id": "claude-haiku-4-5-20251001",
        "capabilities": {
            "thinking": {"types": {"adaptive": {"supported": false}}},
            "code_execution": {"supported": true}
        }
    }))
    .unwrap();
    assert_eq!(
        web_search_value(Some(&live_haiku), &live_haiku.id, true),
        Some(json!({"type": "web_search_20250305", "name": "web_search", "max_uses": 5}))
    );
    let info = ModelInfo {
        provider: PROVIDER_ANTHROPIC.into(),
        id: "claude-newmodel-9".into(),
        display_name: "New".into(),
        adaptive: true,
        always_thinks: false,
        code_exec: false,
        efforts: vec![],
        budget_thinking: false,
        default_effort: None,
    };
    let tool = web_search_value(Some(&info), "claude-newmodel-9", true).unwrap();
    assert_eq!(tool["allowed_callers"], json!(["direct"]));
}

#[test]
fn web_search_tool_lands_in_body_tools() {
    let msgs = vec![user("q")];
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
    let msgs = vec![user("1+1?"), assistant(""), user("а 2+2?")];
    let body = build_request_body("claude-opus-4-8", "s", &msgs, adaptive(), None);
    let arr = body["messages"].as_array().unwrap();
    assert_eq!(arr.len(), 2, "пустой assistant выброшен");
    assert_eq!(arr[0]["content"], "1+1?");
    assert_eq!(arr[1]["content"][0]["cache_control"]["type"], "ephemeral");
}

#[test]
fn empty_system_stays_plain_string() {
    let msgs = vec![user("q")];
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
    assert!(matches!(out.last(), Some(SseOut::Done)));
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
    assert_eq!(
        out,
        vec![SseOut::Retryable {
            code: 529,
            message: "Overloaded".into()
        }]
    );
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

#[test]
fn empty_text_with_images_has_no_text_block() {
    let imgs = vec![ImageAttachment {
        media_type: "image/png".into(),
        data: "AAAA".into(),
    }];
    let content = build_content("", &imgs, false);
    let arr = content.as_array().unwrap();
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["type"], "image");
}

#[test]
fn sse_message_start_carries_no_output() {
    let mut p = SseParser::anthropic();
    let block =
        "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"m\"}}\n\n";
    assert_eq!(p.feed(block), vec![]);
}

#[test]
fn feed_bytes_handles_utf8_split_across_chunks() {
    let raw = "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Привет\"}}\n\n";
    let bytes = raw.as_bytes();
    let cut = raw.find("Привет").unwrap() + 3;
    assert!(
        std::str::from_utf8(&bytes[..cut]).is_err(),
        "разрез должен попадать в середину символа"
    );
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
    let msgs = vec![user("q")];
    let mut sink = CollectingSink::default();
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
    let msgs = vec![user("q")];
    let err = client
        .stream_message(
            build_request_body("claude-opus-4-8", "s", &msgs, adaptive(), None),
            tokio_util::sync::CancellationToken::new(),
            &mut CollectingSink::default(),
        )
        .await
        .unwrap_err();
    assert!(matches!(err, LlmError::Retryable(408)), "got: {err:?}");
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
    let msgs = vec![user("q")];
    let mut sink = CollectingSink::default();
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
    let msgs = vec![user("q")];
    let err = client
        .stream_message(
            build_request_body("claude-opus-4-8", "s", &msgs, adaptive(), None),
            tokio_util::sync::CancellationToken::new(),
            &mut CollectingSink::default(),
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
    let msgs = vec![user("q")];
    let err = client
        .stream_message(
            build_request_body("claude-opus-4-8", "s", &msgs, adaptive(), None),
            tokio_util::sync::CancellationToken::new(),
            &mut CollectingSink::default(),
        )
        .await
        .unwrap_err();
    assert!(matches!(err, LlmError::BadApiKey(_)));
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
    let msgs = vec![user("q")];
    let err = client
        .stream_message(
            build_request_body("claude-opus-4-8", "s", &msgs, adaptive(), None),
            cancel,
            &mut CollectingSink::default(),
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
        let result: Vec<_> = source
            .as_bytes()
            .chunks(chunk_size)
            .flat_map(|chunk| parser.feed_bytes(chunk))
            .collect();
        assert_eq!(
            result,
            vec![
                SseOut::TextDelta("Привет".into()),
                SseOut::TextDelta("second".into()),
                SseOut::TextDelta("third".into())
            ],
            "chunk size {chunk_size}"
        );
    }
    let mut parser = SseParser::with_block_parser(echo_sse_payload);
    let batch = "data: x\n\n".repeat(4096);
    assert_eq!(parser.feed(&batch).len(), 4096);
    assert!(parser.buffer.is_empty());
}

#[test]
fn sse_multiline_payload_preserves_empty_data_lines() {
    let mut parser = SseParser::with_block_parser(echo_sse_payload);
    assert_eq!(
        parser.feed("data:\ndata: next\ndata:\n\n"),
        vec![SseOut::TextDelta("\nnext\n".into())]
    );
}

/// The spec ends an event on any two consecutive line endings, so a server
/// mixing `\r\n` and `\n` (or splitting them across chunks) still frames.
#[test]
fn sse_framing_accepts_mixed_line_endings_as_one_separator() {
    let source = "data: a\n\r\ndata: b\r\n\ndata: c\r\r\ndata: d\n\n";
    for chunk_size in 1..=source.len() {
        let mut parser = SseParser::with_block_parser(echo_sse_payload);
        let result: Vec<_> = source
            .as_bytes()
            .chunks(chunk_size)
            .flat_map(|chunk| parser.feed_bytes(chunk))
            .collect();
        assert_eq!(
            result,
            vec![
                SseOut::TextDelta("a".into()),
                SseOut::TextDelta("b".into()),
                SseOut::TextDelta("c".into()),
                SseOut::TextDelta("d".into())
            ],
            "chunk size {chunk_size}"
        );
    }
}
