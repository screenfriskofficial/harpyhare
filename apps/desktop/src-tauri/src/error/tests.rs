use super::*;
use crate::llm::LlmError;
use crate::stt::SttError;

#[test]
fn llm_errors_map_to_codes() {
    assert_eq!(LlmError::BadApiKey("Anthropic").code(), ErrorCode::BadApiKey);
    assert_eq!(LlmError::BadAccessCode("x".into()).code(), ErrorCode::BadAccessCode);
    assert_eq!(LlmError::Retryable(503).code(), ErrorCode::Retryable);
    assert_eq!(LlmError::Network("x".into()).code(), ErrorCode::Network);
    assert_eq!(LlmError::Api("x".into()).code(), ErrorCode::Api);
    assert_eq!(LlmError::Cancelled.code(), ErrorCode::Cancelled);
}

#[test]
fn stt_errors_map_to_codes() {
    assert_eq!(SttError::BadApiKey("Groq").code(), ErrorCode::BadApiKey);
    assert_eq!(
        SttError::BadAccessCode("x".into()).code(),
        ErrorCode::BadAccessCode
    );
    assert_eq!(SttError::Retryable(429).code(), ErrorCode::Retryable);
    assert_eq!(SttError::Network("x".into()).code(), ErrorCode::Network);
    assert_eq!(SttError::Cancelled.code(), ErrorCode::Cancelled);
    assert_eq!(SttError::Other("x".into()).code(), ErrorCode::Api);
}

#[test]
fn app_error_carries_code_and_display_message() {
    let err = AppError::from(&SttError::Retryable(429));
    assert_eq!(err.code, ErrorCode::Retryable);
    assert!(err.message.contains("429"), "got: {}", err.message);
}

#[test]
fn codes_serialize_as_camel_case() {
    let json = serde_json::to_string(&AppError::new(ErrorCode::BadAccessCode, "нет")).unwrap();
    assert_eq!(json, r#"{"code":"badAccessCode","message":"нет"}"#);
}
