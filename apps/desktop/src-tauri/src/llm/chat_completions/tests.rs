use super::*;
use crate::llm::test_support::{assistant, image, user, user_with_images};
use crate::llm::RequestOptions;

const LABEL: &str = "Vendor";

fn chunk(choice: Value) -> String {
    json!({"choices": [choice]}).to_string()
}

#[test]
fn the_done_sentinel_is_the_terminal_event() {
    assert_eq!(parse_chunk("[DONE]", LABEL), vec![SseOut::Done]);
    assert_eq!(parse_chunk("  [DONE]\n", LABEL), vec![SseOut::Done]);
}

#[test]
fn text_comes_from_string_or_part_array_content_and_reasoning_is_ignored() {
    assert_eq!(
        parse_chunk(&chunk(json!({"delta": {"content": "hi"}})), LABEL),
        vec![SseOut::TextDelta("hi".into())]
    );
    let parts = json!({"delta": {"content": [{"type": "text", "text": "a"}, {"content": "b"}]}});
    assert_eq!(
        parse_chunk(&chunk(parts), LABEL),
        vec![SseOut::TextDelta("ab".into())]
    );
    for silent in [
        json!({"delta": {"content": ""}}),
        json!({"delta": {"reasoning": "hidden"}}),
        json!({"delta": {"reasoning_content": "hidden"}}),
        json!({"delta": {}, "finish_reason": null}),
    ] {
        assert!(parse_chunk(&chunk(silent), LABEL).is_empty());
    }
    assert!(parse_chunk(r#"{"choices":[],"usage":{"prompt_tokens":7}}"#, LABEL).is_empty());
}

#[test]
fn finish_reason_policy_is_the_same_for_every_vendor() {
    assert_eq!(
        parse_chunk(
            &chunk(json!({"delta": {"content": "ok"}, "finish_reason": "stop"})),
            LABEL
        ),
        vec![SseOut::TextDelta("ok".into()), SseOut::Finished]
    );
    for reason in [
        "length",
        "content_filter",
        "tool_calls",
        "function_call",
        "unknown",
    ] {
        assert_eq!(
            parse_chunk(&chunk(json!({"finish_reason": reason})), LABEL),
            vec![SseOut::Incomplete(format!("{LABEL}: {reason}"))],
            "reason: {reason}"
        );
    }
    assert!(matches!(
        parse_chunk(&chunk(json!({"finish_reason": "error"})), LABEL).as_slice(),
        [SseOut::ApiError(message)] if message.starts_with(LABEL)
    ));
}

#[test]
fn a_plain_json_answer_gets_the_same_verdict() {
    assert!(finish_error(&json!({"finish_reason": "stop"}), LABEL).is_ok());
    assert!(finish_error(&json!({}), LABEL).is_ok());
    assert!(matches!(
        finish_error(&json!({"finish_reason": "length"}), LABEL),
        Err(LlmError::Incomplete(_))
    ));
    assert!(matches!(
        finish_error(&json!({"finish_reason": "error"}), LABEL),
        Err(LlmError::Api(_))
    ));
}

#[test]
fn errors_inside_a_200_stream_are_classified_not_finished() {
    assert!(matches!(
        parse_chunk(r#"{"error":{"code":429,"message":"slow down"}}"#, LABEL)[0],
        SseOut::Retryable { code: 429, .. }
    ));
    assert!(matches!(
        parse_chunk(
            r#"{"error":{"code":"server_error","message":"lost"}}"#,
            LABEL
        )[0],
        SseOut::Retryable { code: 500, .. }
    ));
    for code in [json!(402), json!("insufficient_quota")] {
        let event = json!({"error": {"code": code, "message": "credits exhausted"}});
        assert!(matches!(
            &parse_chunk(&event.to_string(), LABEL)[0],
            SseOut::HttpError(error) if error.code == crate::error::ErrorCode::Billing
        ));
    }
    assert!(matches!(
        &parse_chunk(r#"{"error":{"message":"model is not supported"}}"#, LABEL)[0],
        SseOut::ApiError(message) if message == "Vendor: model is not supported"
    ));
    assert!(matches!(
        parse_chunk(r#"{"error":{}}"#, LABEL)[0],
        SseOut::ApiError(_)
    ));
}

#[test]
fn invalid_json_is_an_api_error_that_names_the_vendor() {
    assert!(matches!(
        &parse_chunk("broken JSON", LABEL)[0],
        SseOut::ApiError(message) if message.starts_with("Vendor: ") && message.contains("broken JSON")
    ));
}

#[test]
fn messages_lead_with_system_drop_empty_turns_and_inline_images() {
    let request = LlmRequest {
        model: "m".into(),
        system: "Be concise".into(),
        messages: vec![
            user("Hello"),
            assistant("Previous answer"),
            user_with_images("look", vec![image("image/png", "aGVsbG8=")]),
            user(""),
        ],
        options: RequestOptions::default(),
    };
    let messages = messages_json(&request);
    assert_eq!(messages.len(), 4);
    assert_eq!(
        messages[0],
        json!({"role": "system", "content": "Be concise"})
    );
    assert_eq!(messages[1], json!({"role": "user", "content": "Hello"}));
    assert_eq!(messages[2]["role"], "assistant");
    assert_eq!(
        messages[3]["content"],
        json!([
            {"type": "text", "text": "look"},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,aGVsbG8="}}
        ])
    );
    let blank_system = LlmRequest {
        system: "  ".into(),
        ..request
    };
    assert_eq!(messages_json(&blank_system)[0]["role"], "user");
}
