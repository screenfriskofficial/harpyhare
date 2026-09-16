use super::*;
use serde_json::json;

#[test]
fn quota_is_not_a_retryable_rate_limit_and_forbidden_is_not_a_bad_key() {
    assert_eq!(
        classify(429, &json!({"error":{"code":"insufficient_quota"}}), false),
        ErrorCode::Billing
    );
    assert_eq!(classify(429, &Value::Null, false), ErrorCode::RateLimited);
    assert_eq!(classify(403, &Value::Null, false), ErrorCode::AccessDenied);
    assert_eq!(classify(401, &Value::Null, true), ErrorCode::BadAccessCode);
    assert_eq!(
        classify(503, &Value::Null, true),
        ErrorCode::ServiceUnavailable
    );
    assert_eq!(
        classify(402, &json!({"error":{"code":"daily_limit_exceeded"}}), true),
        ErrorCode::DailyLimit
    );
}

#[test]
fn arbitrary_error_messages_never_determine_classification() {
    assert_eq!(
        classify(
            400,
            &json!({"error":{"message":"insufficient_quota sk-secret"}}),
            false
        ),
        ErrorCode::Api
    );
}
