use super::*;
use crate::llm::{registry, ImageAttachment, SseParser, PROVIDER_OPENAI, PROVIDER_XAI};

fn spec_of(id: &str) -> &'static registry::LlmProviderSpec {
    registry::spec(id).expect("вендор объявлен в реестре")
}

/// Every vendor whose row declares this dialect. New rows join automatically —
/// that is the point of the dialect being data.
fn responses_specs() -> Vec<&'static registry::LlmProviderSpec> {
    registry::PROVIDERS
        .iter()
        .filter(|p| matches!(p.wire, registry::LlmWire::Responses { .. }))
        .collect()
}

fn user(text: &str) -> ChatMessage {
    ChatMessage { role: "user".into(), text: text.into(), images: Vec::new() }
}

fn assistant(text: &str) -> ChatMessage {
    ChatMessage { role: ROLE_ASSISTANT.into(), text: text.into(), images: Vec::new() }
}

#[test]
fn every_vendor_of_this_dialect_has_a_tagged_catalogue() {
    for spec in responses_specs() {
        let models = spec.models();
        assert!(!models.is_empty(), "у {} пустой каталог", spec.id);
        assert!(models.iter().all(|m| m.provider == spec.id));
    }
    let ids: Vec<&str> = responses_specs().iter().map(|p| p.id).collect();
    assert!(ids.contains(&PROVIDER_OPENAI));
    assert!(ids.contains(&PROVIDER_XAI), "Grok обязан обслуживаться этим же диалектом");
}

#[test]
fn the_effort_sent_is_the_one_the_vendor_declared() {
    // Measured against both live APIs: OpenAI takes "none", xAI refuses it.
    // A vendor added with the wrong floor here fails loudly at that vendor.
    for spec in responses_specs() {
        let registry::LlmWire::Responses { effort_off, effort_on, .. } = spec.wire else {
            unreachable!()
        };
        let info = spec.models().into_iter().find(|m| !m.always_thinks).expect("есть adaptive");
        assert_eq!(
            reasoning_value(spec, Some(&info), false),
            Some(json!({ "effort": effort_off })),
            "«выкл» у {}",
            spec.id
        );
        assert_eq!(
            reasoning_value(spec, Some(&info), true),
            Some(json!({ "effort": effort_on })),
            "«вкл» у {}",
            spec.id
        );
    }
}

#[test]
fn openai_and_xai_disagree_about_switching_reasoning_off() {
    let openai = spec_of(PROVIDER_OPENAI);
    let xai = spec_of(PROVIDER_XAI);
    let off = |s: &'static registry::LlmProviderSpec| {
        let m = s.models().into_iter().find(|m| !m.always_thinks).unwrap();
        reasoning_value(s, Some(&m), false).unwrap()["effort"].as_str().unwrap().to_string()
    };
    assert_eq!(off(openai), "none");
    assert_eq!(off(xai), "minimal", "xAI отвергает none — это проверено живым запросом");
}

#[test]
fn always_thinking_model_gets_no_reasoning_field() {
    let spec = spec_of(PROVIDER_OPENAI);
    let always = spec
        .models()
        .into_iter()
        .find(|m| m.always_thinks)
        .expect("в каталоге есть всегда рассуждающая модель");
    // Omitting the field entirely is the only way to talk to a model that
    // refuses the parameter (gpt-5.5-pro, and the grok-4.20 previews).
    assert_eq!(reasoning_value(spec, Some(&always), false), None);
    assert_eq!(reasoning_value(spec, Some(&always), true), None);
}

#[test]
fn web_search_tool_is_sent_only_on_request() {
    assert_eq!(web_search_value(false), None);
    assert_eq!(web_search_value(true), Some(json!({"type": WEB_SEARCH_TOOL_TYPE})));
}

#[test]
fn request_body_puts_system_into_instructions_and_never_stores() {
    let body = build_request_body("gpt-5.6-terra", "будь краток", &[user("привет")], None, None);
    assert_eq!(body["instructions"], "будь краток");
    assert_eq!(body["store"], false);
    assert_eq!(body["stream"], true);
    assert_eq!(body["input"][0]["content"][0]["type"], CONTENT_INPUT_TEXT);
}

#[test]
fn assistant_turns_use_output_text_and_user_turns_input_text() {
    let body = build_request_body(
        "gpt-5.6-terra",
        "",
        &[user("вопрос"), assistant("ответ"), user("ещё")],
        None,
        None,
    );
    assert_eq!(body["input"][0]["content"][0]["type"], CONTENT_INPUT_TEXT);
    assert_eq!(body["input"][1]["content"][0]["type"], CONTENT_OUTPUT_TEXT);
    assert_eq!(body["input"][2]["content"][0]["type"], CONTENT_INPUT_TEXT);
}

#[test]
fn empty_messages_are_dropped_from_input() {
    let body = build_request_body("gpt-5.6-terra", "", &[user(""), user("текст")], None, None);
    assert_eq!(body["input"].as_array().unwrap().len(), 1);
    assert_eq!(body["input"][0]["content"][0]["text"], "текст");
}

#[test]
fn images_travel_as_data_urls() {
    let m = ChatMessage {
        role: "user".into(),
        text: "что тут".into(),
        images: vec![ImageAttachment { media_type: "image/png".into(), data: "QUJD".into() }],
    };
    let body = build_request_body("gpt-5.6-terra", "", &[m], None, None);
    let content = &body["input"][0]["content"];
    assert_eq!(content[0]["type"], CONTENT_INPUT_TEXT);
    assert_eq!(content[1]["type"], CONTENT_INPUT_IMAGE);
    assert_eq!(content[1]["image_url"], "data:image/png;base64,QUJD");
}

/// Полный кадр SSE (с `event:`-строкой) проходит через общий фреймер, а
/// блок-парсер диалекта получает уже склеенную нагрузку `data:`.
#[test]
fn text_deltas_are_parsed() {
    let mut parser = SseParser::with_block_parser(parse_block);
    let frame = "event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"при\"}\n\n";
    assert_eq!(parser.feed(frame), vec![SseOut::TextDelta("при".into())]);
}

#[test]
fn completed_event_ends_the_stream_and_carries_input_tokens() {
    let data = r#"{"type":"response.completed","response":{"usage":{"input_tokens":41}}}"#;
    assert_eq!(parse_block(data), vec![SseOut::Done(Some(41))]);
}

#[test]
fn completed_event_without_usage_still_ends_the_stream() {
    let data = r#"{"type":"response.completed","response":{}}"#;
    assert_eq!(parse_block(data), vec![SseOut::Done(None)]);
}

#[test]
fn failed_response_surfaces_the_api_message() {
    let data = r#"{"type":"response.failed","response":{"error":{"code":"invalid_prompt","message":"нельзя"}}}"#;
    assert_eq!(parse_block(data), vec![SseOut::ApiError("нельзя".into())]);
}

#[test]
fn a_failure_worth_retrying_is_reported_as_such() {
    let data = r#"{"type":"response.failed","response":{"error":{"code":"server_error","message":"перегрузка"}}}"#;
    assert_eq!(
        parse_block(data),
        vec![SseOut::Retryable { code: 500, message: "перегрузка".into() }]
    );
}

#[test]
fn incomplete_response_surfaces_its_reason() {
    let data = r#"{"type":"response.incomplete","response":{"incomplete_details":{"reason":"max_output_tokens"}}}"#;
    assert_eq!(parse_block(data), vec![SseOut::ApiError("max_output_tokens".into())]);
}

#[test]
fn unrelated_events_are_ignored() {
    let data = r#"{"type":"response.in_progress","response":{}}"#;
    assert_eq!(parse_block(data), Vec::<SseOut>::new());
}
