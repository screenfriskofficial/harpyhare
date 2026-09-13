use serde_json::Value;

const MAX_BODY_BYTES: usize = 16 * 1024;
const MAX_MESSAGE_CHARS: usize = 512;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HttpClass {
    BadApiKey,
    BadAccessCode,
    Retryable,
    Api,
}

pub fn classify(status: u16, body: &Value, proxy: bool) -> HttpClass {
    let code = body["error"]["code"]
        .as_str()
        .or_else(|| body["error"]["type"].as_str())
        .or_else(|| body["code"].as_str())
        .unwrap_or_default();
    match code {
        "insufficient_quota" | "insufficient_credits" | "billing_error" => return HttpClass::Api,
        "rate_limit_error" | "rate_limit_exceeded" => return HttpClass::Retryable,
        "authentication_error" | "invalid_api_key" => {
            return if proxy {
                HttpClass::BadAccessCode
            } else {
                HttpClass::BadApiKey
            }
        }
        "invalid_token" if proxy => return HttpClass::BadAccessCode,
        _ => {}
    }
    match status {
        401 if proxy => HttpClass::BadAccessCode,
        401 | 403 => HttpClass::BadApiKey,
        408 | 429 | 500..=599 => HttpClass::Retryable,
        _ => HttpClass::Api,
    }
}

pub async fn read_body(mut response: reqwest::Response) -> (u16, Value, String) {
    let status = response.status().as_u16();
    let mut bytes = Vec::new();
    while let Ok(Some(chunk)) = response.chunk().await {
        if bytes.len() + chunk.len() > MAX_BODY_BYTES {
            break;
        }
        bytes.extend_from_slice(&chunk);
    }
    let value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    let message = value["error"]["message"]
        .as_str()
        .or_else(|| value["message"].as_str())
        .map(|text| text.chars().take(MAX_MESSAGE_CHARS).collect())
        .unwrap_or_else(|| format!("HTTP {status}"));
    (status, value, message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn quota_is_api_error_not_rate_limit() {
        assert_eq!(
            classify(
                429,
                &json!({"error": {"code": "insufficient_quota"}}),
                false
            ),
            HttpClass::Api
        );
        assert_eq!(classify(429, &Value::Null, false), HttpClass::Retryable);
    }

    #[test]
    fn proxy_authentication_is_access_code_error() {
        assert_eq!(classify(401, &Value::Null, true), HttpClass::BadAccessCode);
        assert_eq!(classify(401, &Value::Null, false), HttpClass::BadApiKey);
    }
}
