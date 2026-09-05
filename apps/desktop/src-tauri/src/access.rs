use serde_json::Value;
use std::time::Duration;

const PROXY_BASE_URL: &str = "https://itech-relay.itech-edge.workers.dev";
#[cfg(debug_assertions)]
const PROXY_ENDPOINT_OVERRIDE_ENV: &str = "ITECH_PROXY_ENDPOINT";
#[cfg(debug_assertions)]
const HTTPS_PREFIX: &str = "https://";

const REDEEM_PATH: &str = "/v1/redeem";
const REDEEM_TIMEOUT: Duration = Duration::from_secs(15);
const REDEEM_MAX_ATTEMPTS: u32 = 3;
const REDEEM_RETRY_DELAY: Duration = Duration::from_millis(400);

const REDEEM_BAD_RESPONSE: &str = "Прокси вернул неожиданный ответ на активацию";
const REDEEM_GENERIC_ERROR: &str = "Не удалось активировать код доступа";
const REDEEM_EMPTY_TOKEN: &str = "Прокси вернул пустой токен";
/// IP-лимит `/v1/redeem`: код тут ни при чём, и говорить «неверный код» нельзя.
const REDEEM_RATE_LIMITED: &str = "Слишком много попыток активации — подожди минуту и повтори";
const HTTP_TOO_MANY_REQUESTS: u16 = 429;

pub fn proxy_base_url() -> String {
    #[cfg(debug_assertions)]
    {
        if let Ok(url) = std::env::var(PROXY_ENDPOINT_OVERRIDE_ENV) {
            let url = url.trim();
            if url.starts_with(HTTPS_PREFIX) {
                return url.to_string();
            }
        }
    }
    PROXY_BASE_URL.to_string()
}

#[derive(serde::Serialize)]
struct RedeemRequest<'a> {
    code: &'a str,
    idempotency_key: &'a str,
}

#[derive(serde::Deserialize)]
struct RedeemResponse {
    token: String,
}

pub async fn redeem(base_url: &str, code: &str, idempotency_key: &str) -> Result<String, String> {
    crate::tls::ensure_crypto_provider();
    let client = reqwest::Client::builder()
        .user_agent(crate::llm::APP_USER_AGENT)
        .timeout(REDEEM_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("{base_url}{REDEEM_PATH}");
    let payload = RedeemRequest {
        code: code.trim(),
        idempotency_key,
    };
    let mut last_network_error = REDEEM_GENERIC_ERROR.to_string();
    for attempt in 0..REDEEM_MAX_ATTEMPTS {
        if attempt > 0 {
            tokio::time::sleep(REDEEM_RETRY_DELAY).await;
        }
        match client.post(&url).json(&payload).send().await {
            Ok(resp) => return parse_redeem(resp).await,
            Err(e) => last_network_error = e.to_string(),
        }
    }
    Err(last_network_error)
}

async fn parse_redeem(resp: reqwest::Response) -> Result<String, String> {
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if status.as_u16() == HTTP_TOO_MANY_REQUESTS {
        return Err(redeem_error_message_or(&body, REDEEM_RATE_LIMITED));
    }
    if !status.is_success() {
        return Err(redeem_error_message_or(&body, REDEEM_GENERIC_ERROR));
    }
    let token = serde_json::from_str::<RedeemResponse>(&body)
        .map(|r| r.token)
        .map_err(|_| REDEEM_BAD_RESPONSE.to_string())?;
    if token.trim().is_empty() {
        return Err(REDEEM_EMPTY_TOKEN.to_string());
    }
    Ok(token)
}

fn redeem_error_message_or(body: &str, fallback: &str) -> String {
    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v["error"]["message"].as_str().map(str::to_string))
        .filter(|m| !m.trim().is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

#[cfg(test)]
mod tests;
