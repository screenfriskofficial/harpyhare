//! The OpenAI Responses API — a dialect, not a vendor.
//!
//! Spoken verbatim by OpenAI and xAI (same paths, same SSE event names, same
//! usage shape), so a vendor that speaks it needs a row in `registry` and
//! nothing else. What still differs between them is data, and lives on
//! `LlmWire::Responses`.

use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

use super::http::{Credential, LlmHttp};
use super::registry::{LlmProviderSpec, LlmWire};
use super::{
    sse_data_json, ChatMessage, ImageAttachment, LlmError, LlmProvider, LlmRequest, LlmStreamSink,
    ModelInfo, SseOut, SseParser, LIST_MODELS_TIMEOUT, MODELS_PATH, UNKNOWN_API_ERROR,
    UNKNOWN_TOKEN_COUNT,
};

const RESPONSES_PATH: &str = "/v1/responses";

const MAX_OUTPUT_TOKENS: u32 = 64000;

/// `response.failed` с этими кодами — повод повторить, а не ошибка запроса;
/// HTTP-эквивалент уходит в `LlmError::Retryable`.
const RETRYABLE_FAILURE_CODES: [(&str, u16); 2] =
    [("rate_limit_exceeded", 429), ("server_error", 500)];

const WEB_SEARCH_TOOL_TYPE: &str = "web_search";

const ROLE_ASSISTANT: &str = "assistant";
const CONTENT_INPUT_TEXT: &str = "input_text";
const CONTENT_INPUT_IMAGE: &str = "input_image";
const CONTENT_OUTPUT_TEXT: &str = "output_text";

/// Effort values of the spec's dialect. Panics only if a `Responses` client was
/// built from a row that is not `LlmWire::Responses`, which `build_provider`
/// cannot do.
fn efforts(spec: &LlmProviderSpec) -> (&'static str, &'static str) {
    match spec.wire {
        LlmWire::Responses { effort_off, effort_on, .. } => (effort_off, effort_on),
        LlmWire::Anthropic { .. } | LlmWire::Xclis { .. } => {
            unreachable!("клиент Responses собран из чужого диалекта")
        }
    }
}

/// `None` means "send no `reasoning` field at all" — the only way to talk to a
/// model that refuses the parameter outright (`gpt-5.5-pro`, `grok-4.20-*`).
pub fn reasoning_value(
    spec: &LlmProviderSpec,
    info: Option<&ModelInfo>,
    requested: bool,
) -> Option<Value> {
    if info.is_some_and(|m| m.always_thinks) {
        return None;
    }
    let (off, on) = efforts(spec);
    Some(json!({"effort": if requested { on } else { off }}))
}

pub fn web_search_value(requested: bool) -> Option<Value> {
    requested.then(|| json!({"type": WEB_SEARCH_TOOL_TYPE}))
}
fn image_block(img: &ImageAttachment) -> Value {
    json!({
        "type": CONTENT_INPUT_IMAGE,
        "image_url": format!("data:{};base64,{}", img.media_type, img.data)
    })
}

fn text_block(role: &str, text: &str) -> Value {
    let block_type =
        if role == ROLE_ASSISTANT { CONTENT_OUTPUT_TEXT } else { CONTENT_INPUT_TEXT };
    json!({"type": block_type, "text": text})
}

fn message_json(m: &ChatMessage) -> Value {
    let mut content: Vec<Value> = m.images.iter().map(image_block).collect();
    if !m.text.is_empty() {
        content.insert(0, text_block(&m.role, &m.text));
    }
    json!({"role": m.role, "content": content})
}

pub fn build_request_body(
    model: &str,
    system: &str,
    messages: &[ChatMessage],
    reasoning: Option<Value>,
    web_search: Option<Value>,
) -> Value {
    let input: Vec<Value> = messages
        .iter()
        .filter(|m| !m.text.is_empty() || !m.images.is_empty())
        .map(message_json)
        .collect();
    let mut body = json!({
        "model": model,
        "instructions": system,
        "input": input,
        "stream": true,
        "store": false,
        "max_output_tokens": MAX_OUTPUT_TOKENS
    });
    if let Some(r) = reasoning {
        body["reasoning"] = r;
    }
    if let Some(tool) = web_search {
        body["tools"] = json!([tool]);
    }
    body
}

/// Разбор одного события диалекта; на вход — склеенная нагрузка `data:`.
pub fn parse_block(data: &str) -> Vec<SseOut> {
    let Some(v) = sse_data_json(data) else {
        return Vec::new();
    };
    let out = match v["type"].as_str() {
        Some("response.output_text.delta") => {
            v["delta"].as_str().map(|d| SseOut::TextDelta(d.to_string()))
        }
        Some("response.completed") => {
            let total = v["response"]["usage"]["input_tokens"].as_u64().unwrap_or(0);
            Some(SseOut::Done((total > 0).then_some(total as u32)))
        }
        Some("response.failed") => Some(failure_out(&v)),
        Some("response.incomplete" | "error") => Some(SseOut::ApiError(
            error_message(&v).unwrap_or(UNKNOWN_API_ERROR).to_string(),
        )),
        _ => None,
    };
    out.into_iter().collect()
}

fn failure_out(v: &Value) -> SseOut {
    let message = error_message(v).unwrap_or(UNKNOWN_API_ERROR).to_string();
    let code = v["response"]["error"]["code"].as_str().unwrap_or_default();
    match RETRYABLE_FAILURE_CODES.iter().find(|(c, _)| *c == code) {
        Some((_, status)) => SseOut::Retryable { code: *status, message },
        None => SseOut::ApiError(message),
    }
}

fn error_message(v: &Value) -> Option<&str> {
    v["response"]["error"]["message"]
        .as_str()
        .or_else(|| v["response"]["incomplete_details"]["reason"].as_str())
        .or_else(|| v["error"]["message"].as_str())
        .or_else(|| v["message"].as_str())
}

/// Serves any vendor whose row declares `LlmWire::Responses`. Everything it
/// needs to tell them apart is on that row, so a new one is data only.
#[derive(Clone)]
pub struct ResponsesClient {
    spec: &'static LlmProviderSpec,
    http: LlmHttp,
}

impl ResponsesClient {
    pub fn direct(spec: &'static LlmProviderSpec, api_key: String) -> Self {
        Self {
            spec,
            http: LlmHttp::direct(
                spec.wire.base_url(),
                Credential::Bearer(api_key),
                spec.wire.key_label(),
            ),
        }
    }

    pub fn proxied(spec: &'static LlmProviderSpec, access_token: String, base_url: String) -> Self {
        Self { spec, http: LlmHttp::proxied(base_url, access_token, spec.wire.key_label()) }
    }

    pub fn with_base_url(mut self, url: String) -> Self {
        self.http = self.http.with_base_url(url);
        self
    }

    fn catalog(&self) -> Vec<ModelInfo> {
        self.spec.models()
    }

    /// `/v1/models` of this dialect answers two different ways. Every vendor
    /// lists the ids a key may call, which is all OpenAI offers; xAI also
    /// publishes `context_length`, and that is the only honest source for the
    /// context gauge's denominator. Reading it when present needs no per-vendor
    /// flag — a vendor that omits it simply leaves the window unknown.
    async fn live_models(&self) -> Result<Vec<(String, u32)>, LlmError> {
        let v = self.http.get_json(MODELS_PATH, LIST_MODELS_TIMEOUT).await?;
        Ok(v["data"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|m| {
                        let id = m["id"].as_str()?.to_string();
                        let window = m["context_length"].as_u64().unwrap_or(0) as u32;
                        Some((id, window))
                    })
                    .collect()
            })
            .unwrap_or_default())
    }
}

#[async_trait::async_trait]
impl LlmProvider for ResponsesClient {
    fn provider_id(&self) -> &'static str {
        self.spec.id
    }

    fn known_models(&self) -> Vec<ModelInfo> {
        self.catalog()
    }

    async fn stream(
        &self,
        request: LlmRequest,
        cancel: CancellationToken,
        sink: &mut dyn LlmStreamSink,
    ) -> Result<(), LlmError> {
        let info = self.catalog().into_iter().find(|m| m.id == request.model);
        let body = build_request_body(
            &request.model,
            &request.system,
            &request.messages,
            reasoning_value(self.spec, info.as_ref(), request.options.thinking),
            web_search_value(request.options.web_search),
        );
        self.http
            .post_sse(
                RESPONSES_PATH,
                &body,
                SseParser::with_block_parser(parse_block),
                cancel,
                sink,
            )
            .await
    }

    /// No vendor of this dialect publishes a token counter. 0 is the app's own
    /// "unknown", which the context gauge already understands — an error here
    /// would only add retries and log noise for something not offered.
    async fn count_tokens(&self, _request: LlmRequest) -> Result<u32, LlmError> {
        Ok(UNKNOWN_TOKEN_COUNT)
    }

    /// Through the relay the catalogue cannot be probed: `/v1/models` there is
    /// Anthropic's, and giving another vendor its own path would break the
    /// path==upstream symmetry the audio routes rely on. What a code holder may
    /// call is decided by the worker's allowlist instead.
    async fn list_models(&self) -> Result<Vec<ModelInfo>, LlmError> {
        if self.http.is_proxy() {
            return Ok(self.catalog());
        }
        let live = self.live_models().await?;
        Ok(self
            .catalog()
            .into_iter()
            .filter_map(|mut m| {
                let (_, window) = live.iter().find(|(id, _)| id == &m.id)?;
                m.max_input_tokens = *window;
                Some(m)
            })
            .collect())
    }

    async fn reachable(&self) -> bool {
        self.http.reachable(MODELS_PATH).await
    }

    async fn warm_up(&self) {
        self.http.warm_up(MODELS_PATH).await;
    }
}

#[cfg(test)]
mod tests;
