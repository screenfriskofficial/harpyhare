//! Classify machine-readable failures once for all HTTP providers. Untrusted
//! provider prose is neither a control signal nor part of an exported report.
use super::ErrorCode;
use serde_json::Value;

const MAX_ERROR_BODY_BYTES: usize = 16 * 1024;
const MAX_ERROR_MESSAGE_CHARS: usize = 512;

pub fn classify(status: u16, body: &Value, proxy: bool) -> ErrorCode {
    let code = body["error"]["code"]
        .as_str()
        .or_else(|| body["error"]["type"].as_str())
        .or_else(|| body["code"].as_str())
        .unwrap_or_default();
    match code {
        "daily_limit_exceeded" => return ErrorCode::DailyLimit,
        "insufficient_quota"
        | "insufficient_credits"
        | "billing_error"
        | "credit_balance_too_low" => return ErrorCode::Billing,
        "model_not_allowed" | "model_not_found" => return ErrorCode::ModelUnavailable,
        "service_misconfigured" => return ErrorCode::ServiceUnavailable,
        "authentication_error" if proxy => return ErrorCode::BadAccessCode,
        "authentication_error" => return ErrorCode::BadApiKey,
        "permission_error" => return ErrorCode::AccessDenied,
        "rate_limit_error" | "rate_limit_exceeded" => return ErrorCode::RateLimited,
        "overloaded_error" | "server_error" => return ErrorCode::ServiceUnavailable,
        "context_too_long" | "context_length_exceeded" | "request_too_large" | "audio_too_long" => {
            return ErrorCode::RequestTooLarge
        }
        "invalid_token" if proxy => return ErrorCode::BadAccessCode,
        _ => {}
    }
    match status {
        401 if proxy => ErrorCode::BadAccessCode,
        401 => ErrorCode::BadApiKey,
        402 => ErrorCode::Billing,
        403 => ErrorCode::AccessDenied,
        408 | 504 => ErrorCode::Timeout,
        413 => ErrorCode::RequestTooLarge,
        429 => ErrorCode::RateLimited,
        500..=599 => ErrorCode::ServiceUnavailable,
        _ => ErrorCode::Api,
    }
}

#[derive(Clone, Debug, PartialEq, thiserror::Error)]
#[error("HTTP {status}")]
pub struct HttpFailure {
    pub status: u16,
    pub code: ErrorCode,
    // Internal provider compatibility only (e.g. Xclis catalogue rejections).
    // DiagnosticRecord has no field accepting this untrusted text.
    pub message: String,
}

pub async fn failure(mut response: reqwest::Response, proxy: bool) -> HttpFailure {
    let status = response.status().as_u16();
    let mut body = Vec::new();
    while let Ok(Some(chunk)) = response.chunk().await {
        if body.len() + chunk.len() > MAX_ERROR_BODY_BYTES {
            break;
        }
        body.extend_from_slice(&chunk);
    }
    let value = serde_json::from_slice(&body).unwrap_or(Value::Null);
    let message = value["error"]["message"]
        .as_str()
        .or_else(|| value["err_msg"].as_str())
        .or_else(|| value["message"].as_str())
        .map(|m| m.chars().take(MAX_ERROR_MESSAGE_CHARS).collect())
        .unwrap_or_else(|| format!("HTTP {status}"));
    HttpFailure {
        status,
        code: classify(status, &value, proxy),
        message,
    }
}

#[cfg(test)]
mod tests {
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
}
