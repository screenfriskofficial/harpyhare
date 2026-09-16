//! Classify machine-readable failures once for all HTTP providers. Untrusted
//! provider prose is neither a control signal nor part of an exported report.
use super::ErrorCode;
use serde_json::Value;

const MAX_ERROR_BODY_BYTES: usize = 16 * 1024;
const MAX_ERROR_MESSAGE_CHARS: usize = 512;
/// Non-JSON bodies (Cloudflare's `error code: 1010`, an HTML gateway page)
/// keep a short snippet next to the status: «HTTP 403» alone hides exactly
/// the clue that tells the relay's browser check apart from a dead key.
const MAX_ERROR_SNIPPET_CHARS: usize = 120;
/// The status a port reports for "the server did not answer in time"
/// (`Retryable(408)`): a real timeout at a live host, not a dead network.
pub const TIMEOUT_STATUS: u16 = 408;

/// The two provider error enums (`LlmError`, `SttError`) are shaped alike, and
/// the rules that turn a transport failure into one of them have to stay
/// identical: which statuses are retryable, what a 401 means through the relay,
/// when a timeout is "no connection". Those rules are written once, below;
/// each enum only supplies its constructors.
pub trait ProviderError {
    fn bad_api_key(key_label: &'static str) -> Self;
    fn bad_access_code(message: String) -> Self;
    fn api(message: String) -> Self;
    fn retryable(status: u16) -> Self;
    fn http(failure: HttpFailure) -> Self;
    fn network(message: String) -> Self;
}

/// A non-2xx response as the port's error.
pub fn provider_error<E: ProviderError>(failure: HttpFailure, key_label: &'static str) -> E {
    match failure.code {
        ErrorCode::BadApiKey => E::bad_api_key(key_label),
        ErrorCode::BadAccessCode => E::bad_access_code(failure.message),
        ErrorCode::Api => E::api(failure.message),
        ErrorCode::RateLimited | ErrorCode::ServiceUnavailable | ErrorCode::Timeout => {
            E::retryable(failure.status)
        }
        _ => E::http(failure),
    }
}

/// A failed `reqwest` send as the port's error. A timeout at a host that did
/// accept the connection is "the server did not make it in time" (retryable),
/// not "no connection": the latter raises the connectivity overlay in the
/// frontend while the network is fine and only the upload or the inference is
/// slow. A connect timeout is a dead network and stays one.
pub fn transport_error<E: ProviderError>(error: &reqwest::Error) -> E {
    if error.is_timeout() && !error.is_connect() {
        return E::retryable(TIMEOUT_STATUS);
    }
    E::network(reqwest_error_chain(error))
}

/// reqwest's `Display` hides the cause («error sending request»); the user and
/// the logs need exactly that — a timeout, a TLS refusal or DNS — so the whole
/// source chain is joined behind the kind of failure.
pub fn reqwest_error_chain(error: &reqwest::Error) -> String {
    let kind = if error.is_connect() {
        "ошибка подключения"
    } else if error.is_body() || error.is_decode() {
        "ошибка чтения ответа"
    } else {
        "ошибка запроса"
    };
    let mut details = vec![error.to_string()];
    let mut source = std::error::Error::source(error);
    while let Some(cause) = source {
        let text = cause.to_string();
        if !text.trim().is_empty() && !details.contains(&text) {
            details.push(text);
        }
        source = cause.source();
    }
    format!("{kind}: {}", details.join(": "))
}

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
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .map(|m| m.chars().take(MAX_ERROR_MESSAGE_CHARS).collect())
        .unwrap_or_else(|| status_message(status, &body));
    HttpFailure {
        status,
        code: classify(status, &value, proxy),
        message,
    }
}

/// «HTTP 403» plus a bounded snippet of a body that carried no JSON message.
fn status_message(status: u16, body: &[u8]) -> String {
    let text = String::from_utf8_lossy(body);
    let snippet: String = text.trim().chars().take(MAX_ERROR_SNIPPET_CHARS).collect();
    if snippet.is_empty() {
        format!("HTTP {status}")
    } else {
        format!("HTTP {status}: {snippet}")
    }
}

#[cfg(test)]
mod tests;
