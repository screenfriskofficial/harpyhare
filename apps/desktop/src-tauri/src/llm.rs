//! The LLM port and the Anthropic client.
//!
//! Adding a vendor touches three places and none of them is here: a row in
//! `registry`, a module beside `openai`, and one arm in
//! `app_state::build_provider`. See «Как добавить нового LLM-вендора» in
//! `apps/desktop/CLAUDE.md`.

use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio_util::sync::CancellationToken;

use http::{Credential, LlmHttp};

/// Transport shared by every vendor: pool, auth, status mapping, SSE pumping.
pub mod http;
pub mod openrouter;
/// The one table a new vendor is declared in; exported to the frontend.
pub mod registry;
/// The OpenAI Responses dialect, shared by more than one vendor.
pub mod responses;
/// Dispatches each request to the vendor that owns the requested model.
pub mod router;

pub const APP_USER_AGENT: &str = concat!("AudioSystem/", env!("CARGO_PKG_VERSION"));

pub const PROVIDER_ANTHROPIC: &str = "anthropic";
pub const PROVIDER_OPENAI: &str = "openai";
pub const PROVIDER_XAI: &str = "xai";

/// New chats start here. Paired with `DEFAULT_MODEL` in `lib/chats.ts`,
/// which reads it out of the generated registry rather than repeating it.
pub const DEFAULT_MODEL: &str = "claude-haiku-4-5-20251001";

pub const UNKNOWN_MAX_INPUT_TOKENS: u32 = 0;
pub const UNKNOWN_TOKEN_COUNT: u32 = 0;

const ANTHROPIC_BASE_URL: &str = "https://api.anthropic.com";
const MESSAGES_PATH: &str = "/v1/messages";
const COUNT_TOKENS_PATH: &str = "/v1/messages/count_tokens";
pub(crate) const MODELS_PATH: &str = "/v1/models";
const MODELS_PAGE_LIMIT: u32 = 100;

const API_KEY_HEADER: &str = "x-api-key";
const VERSION_HEADER: &str = "anthropic-version";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const ANTHROPIC_KEY_LABEL: &str = "Anthropic";

const MAX_TOKENS: u32 = 64000;

const THINKING_ADAPTIVE: &str = "adaptive";
const THINKING_DISABLED: &str = "disabled";

const WEB_SEARCH_TOOL_TYPE: &str = "web_search_20260209";
const WEB_SEARCH_TOOL_NAME: &str = "web_search";
const WEB_SEARCH_MAX_USES: u32 = 5;
const WEB_SEARCH_DIRECT_CALLERS: [&str; 1] = ["direct"];

const CACHE_TYPE_EPHEMERAL: &str = "ephemeral";

const HAIKU_PREFIX: &str = "claude-haiku";
const ALWAYS_THINKING_PREFIXES: [&str; 2] = ["claude-fable", "claude-mythos"];

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const DEFAULT_READ_TIMEOUT: Duration = Duration::from_secs(60);
const HTTP2_KEEP_ALIVE_INTERVAL: Duration = Duration::from_secs(30);
const HTTP2_KEEP_ALIVE_TIMEOUT: Duration = Duration::from_secs(5);
const PROBE_CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
pub(crate) const WARM_UP_TIMEOUT: Duration = Duration::from_secs(5);
pub(crate) const LIST_MODELS_TIMEOUT: Duration = Duration::from_secs(15);

const SSE_EVENT_SEPARATOR: &str = "\n\n";
const SSE_DATA_PREFIX: &str = "data: ";

const TRUNCATED_STREAM_ERROR: &str = "ответ оборван до завершения";
pub(crate) const UNKNOWN_API_ERROR: &str = "неизвестная ошибка API";

#[derive(Debug, thiserror::Error)]
pub enum LlmError {
    #[error("Неверный ключ {0} — проверь в настройках")]
    BadApiKey(&'static str),
    #[error("Сервис ответов перегружен, попробуй позже ({0})")]
    Retryable(u16),
    #[error("Нет соединения — проверь интернет/VPN: {0}")]
    Network(String),
    #[error("Ошибка API: {0}")]
    Api(String),
    #[error("Остановлено")]
    Cancelled,
}

impl crate::error::CodedError for LlmError {
    fn code(&self) -> crate::error::ErrorCode {
        use crate::error::ErrorCode;
        match self {
            LlmError::BadApiKey(_) => ErrorCode::BadApiKey,
            LlmError::Retryable(_) => ErrorCode::Retryable,
            LlmError::Network(_) => ErrorCode::Network,
            LlmError::Api(_) => ErrorCode::Api,
            LlmError::Cancelled => ErrorCode::Cancelled,
        }
    }
}

pub type ModelCatalog = Arc<Mutex<Vec<ModelInfo>>>;

#[derive(Debug, Clone, Default, PartialEq, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", default)]
pub struct RequestOptions {
    pub thinking: bool,
    pub web_search: bool,
}

#[derive(Debug, Clone)]
pub struct LlmRequest {
    pub model: String,
    pub system: String,
    pub messages: Vec<ChatMessage>,
    pub options: RequestOptions,
}

pub trait LlmStreamSink: Send {
    fn text_delta(&mut self, delta: &str);
    fn input_tokens(&mut self, total: u32);
}

#[async_trait::async_trait]
pub trait LlmProvider: Send + Sync {
    fn provider_id(&self) -> &'static str;
    fn known_models(&self) -> Vec<ModelInfo>;
    fn owns_model(&self, _model_id: &str) -> bool {
        false
    }
    async fn stream(
        &self,
        request: LlmRequest,
        cancel: CancellationToken,
        sink: &mut dyn LlmStreamSink,
    ) -> Result<(), LlmError>;
    async fn count_tokens(&self, request: LlmRequest) -> Result<u32, LlmError>;
    async fn list_models(&self) -> Result<Vec<ModelInfo>, LlmError>;
    async fn reachable(&self) -> bool;
    async fn warm_up(&self);
}

/// Sent on every Anthropic request; `warm_up` is the deliberate exception —
/// it only opens the socket and throws the answer away.
const ANTHROPIC_HEADERS: http::StaticHeaders = &[(VERSION_HEADER, ANTHROPIC_VERSION)];

#[derive(Clone)]
pub struct AnthropicClient {
    http: LlmHttp,
    catalog: ModelCatalog,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub display_name: String,
    pub provider: String,
    pub adaptive: bool,
    pub always_thinks: bool,
    pub code_exec: bool,
    pub max_input_tokens: u32,
}

fn fallback_adaptive(id: &str) -> bool {
    !id.starts_with(HAIKU_PREFIX)
}

fn fallback_code_exec(id: &str) -> bool {
    !id.starts_with(HAIKU_PREFIX)
}

fn always_thinks(id: &str) -> bool {
    ALWAYS_THINKING_PREFIXES.iter().any(|p| id.starts_with(p))
}

fn model_info_from_json(v: &Value) -> Option<ModelInfo> {
    let id = v["id"].as_str()?.to_string();
    let display_name = v["display_name"].as_str().unwrap_or(&id).to_string();
    let adaptive = v["capabilities"]["thinking"]["types"]["adaptive"]["supported"]
        .as_bool()
        .unwrap_or_else(|| fallback_adaptive(&id));
    let code_exec = v["capabilities"]["code_execution"]["supported"]
        .as_bool()
        .unwrap_or_else(|| fallback_code_exec(&id));
    Some(ModelInfo {
        always_thinks: always_thinks(&id),
        provider: PROVIDER_ANTHROPIC.into(),
        adaptive,
        code_exec,
        max_input_tokens: v["max_input_tokens"]
            .as_u64()
            .unwrap_or(UNKNOWN_MAX_INPUT_TOKENS.into()) as u32,
        id,
        display_name,
    })
}

pub fn fallback_models() -> Vec<ModelInfo> {
    registry::catalog_models(PROVIDER_ANTHROPIC)
}

pub fn thinking_value(info: Option<&ModelInfo>, model_id: &str, requested: bool) -> Option<Value> {
    let adaptive = info.map_or_else(|| fallback_adaptive(model_id), |m| m.adaptive);
    let always = info.map_or_else(|| always_thinks(model_id), |m| m.always_thinks);
    if always {
        return None;
    }
    if requested {
        adaptive.then(|| json!({"type": THINKING_ADAPTIVE}))
    } else if adaptive {
        Some(json!({"type": THINKING_DISABLED}))
    } else {
        None
    }
}

pub fn web_search_value(
    info: Option<&ModelInfo>,
    model_id: &str,
    requested: bool,
) -> Option<Value> {
    if !requested {
        return None;
    }
    let code_exec = info.map_or_else(|| fallback_code_exec(model_id), |m| m.code_exec);
    let mut tool = json!({
        "type": WEB_SEARCH_TOOL_TYPE,
        "name": WEB_SEARCH_TOOL_NAME,
        "max_uses": WEB_SEARCH_MAX_USES
    });
    if !code_exec {
        tool["allowed_callers"] = json!(WEB_SEARCH_DIRECT_CALLERS);
    }
    Some(tool)
}

pub(crate) fn build_http_client(read_timeout: Duration) -> reqwest::Client {
    let builder = reqwest::Client::builder()
        .user_agent(APP_USER_AGENT)
        .connect_timeout(CONNECT_TIMEOUT)
        .read_timeout(read_timeout)
        .pool_idle_timeout(None)
        .http2_keep_alive_interval(HTTP2_KEEP_ALIVE_INTERVAL)
        .http2_keep_alive_timeout(HTTP2_KEEP_ALIVE_TIMEOUT)
        .http2_keep_alive_while_idle(true);
    #[cfg(test)]
    let builder = builder.no_proxy();
    builder
        .build()
        .expect("reqwest client")
}

pub(crate) fn build_probe_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(APP_USER_AGENT)
        .connect_timeout(PROBE_CONNECT_TIMEOUT)
        .timeout(WARM_UP_TIMEOUT)
        .pool_max_idle_per_host(0)
        .http1_only()
        .build()
        .expect("probe reqwest client")
}

pub(crate) async fn require_ok_status(
    resp: reqwest::Response,
    key_label: &'static str,
    proxy: bool,
) -> Result<reqwest::Response, LlmError> {
    match resp.status().as_u16() {
        200 => Ok(resp),
        _ => {
            let (code, body, message) = crate::error::http::read_body(resp).await;
            match crate::error::http::classify(code, &body, proxy) {
                crate::error::http::HttpClass::BadAccessCode => Err(LlmError::Api(message)),
                crate::error::http::HttpClass::BadApiKey => Err(LlmError::BadApiKey(key_label)),
                crate::error::http::HttpClass::Retryable => Err(LlmError::Retryable(code)),
                crate::error::http::HttpClass::Api => Err(LlmError::Api(message)),
            }
        }
    }
}

pub(crate) async fn pump_sse_stream(
    resp: reqwest::Response,
    mut parser: SseParser,
    cancel: &CancellationToken,
    sink: &mut dyn LlmStreamSink,
) -> Result<(), LlmError> {
    let mut stream = resp.bytes_stream();
    loop {
        let chunk = tokio::select! {
            c = stream.next() => c,
            _ = cancel.cancelled() => return Err(LlmError::Cancelled),
        };
        let Some(chunk) = chunk else {
            return Err(LlmError::Network(TRUNCATED_STREAM_ERROR.into()));
        };
        let bytes = chunk.map_err(|e| LlmError::Network(e.to_string()))?;
        for out in parser.feed_bytes(&bytes) {
            match out {
                SseOut::TextDelta(t) => sink.text_delta(&t),
                SseOut::InputTokens(n) => sink.input_tokens(n),
                SseOut::Done(tokens) => {
                    if let Some(n) = tokens {
                        sink.input_tokens(n);
                    }
                    return Ok(());
                }
                SseOut::Retryable(code, _message) => return Err(LlmError::Retryable(code)),
                SseOut::ApiError(m) => return Err(LlmError::Api(m)),
            }
        }
    }
}

impl AnthropicClient {
    pub fn new(api_key: String) -> Self {
        Self::over(LlmHttp::direct(
            ANTHROPIC_BASE_URL,
            Credential::ApiKeyHeader {
                header: API_KEY_HEADER,
                key: api_key,
            },
            ANTHROPIC_KEY_LABEL,
        ))
    }

    pub fn for_proxy(access_token: String, base_url: String) -> Self {
        Self::over(LlmHttp::proxied(
            base_url,
            access_token,
            ANTHROPIC_KEY_LABEL,
        ))
    }

    fn over(http: LlmHttp) -> Self {
        Self {
            http: http.with_headers(ANTHROPIC_HEADERS),
            catalog: ModelCatalog::default(),
        }
    }

    pub fn with_catalog(mut self, catalog: ModelCatalog) -> Self {
        self.catalog = catalog;
        self
    }

    pub fn with_base_url(mut self, url: String) -> Self {
        self.http = self.http.with_base_url(url);
        self
    }

    pub fn with_read_timeout(mut self, d: Duration) -> Self {
        self.http = self.http.with_read_timeout(d);
        self
    }

    fn cached_model(&self, model_id: &str) -> Option<ModelInfo> {
        self.catalog
            .lock()
            .unwrap()
            .iter()
            .find(|m| m.id == model_id)
            .cloned()
    }

    fn capability_fields(&self, request: &LlmRequest) -> (Option<Value>, Option<Value>) {
        let info = self.cached_model(&request.model);
        (
            thinking_value(info.as_ref(), &request.model, request.options.thinking),
            web_search_value(info.as_ref(), &request.model, request.options.web_search),
        )
    }

    async fn fetch_models(&self) -> Result<Vec<ModelInfo>, LlmError> {
        let path = format!("{MODELS_PATH}?limit={MODELS_PAGE_LIMIT}");
        let v = self.http.get_json(&path, LIST_MODELS_TIMEOUT).await?;
        Ok(v["data"]
            .as_array()
            .map(|arr| arr.iter().filter_map(model_info_from_json).collect())
            .unwrap_or_default())
    }

    async fn post_count_tokens(&self, body: Value) -> Result<u32, LlmError> {
        let v = self.http.post_json(COUNT_TOKENS_PATH, &body).await?;
        v["input_tokens"]
            .as_u64()
            .map(|n| n as u32)
            .ok_or_else(|| LlmError::Api(UNKNOWN_API_ERROR.into()))
    }

    pub async fn stream_message(
        &self,
        body: serde_json::Value,
        cancel: CancellationToken,
        sink: &mut dyn LlmStreamSink,
    ) -> Result<(), LlmError> {
        self.http
            .post_sse(MESSAGES_PATH, &body, SseParser::anthropic(), cancel, sink)
            .await
    }
}

#[async_trait::async_trait]
impl LlmProvider for AnthropicClient {
    fn provider_id(&self) -> &'static str {
        PROVIDER_ANTHROPIC
    }

    fn known_models(&self) -> Vec<ModelInfo> {
        fallback_models()
    }

    async fn stream(
        &self,
        request: LlmRequest,
        cancel: CancellationToken,
        sink: &mut dyn LlmStreamSink,
    ) -> Result<(), LlmError> {
        let (thinking, web_search) = self.capability_fields(&request);
        let body = build_request_body(
            &request.model,
            &request.system,
            &request.messages,
            thinking,
            web_search,
        );
        self.stream_message(body, cancel, sink).await
    }

    async fn count_tokens(&self, request: LlmRequest) -> Result<u32, LlmError> {
        let (thinking, web_search) = self.capability_fields(&request);
        let body = build_count_tokens_body(
            &request.model,
            &request.system,
            &request.messages,
            thinking,
            web_search,
        );
        self.post_count_tokens(body).await
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, LlmError> {
        let models = self.fetch_models().await?;
        if !models.is_empty() {
            *self.catalog.lock().unwrap() = models.clone();
        }
        Ok(models)
    }

    async fn reachable(&self) -> bool {
        self.http.reachable(MODELS_PATH).await
    }

    async fn warm_up(&self) {
        self.http.warm_up(MODELS_PATH).await;
    }
}

#[derive(Debug, Clone, Deserialize, specta::Type)]
pub struct ImageAttachment {
    pub media_type: String,
    pub data: String,
}

#[derive(Debug, Clone, Deserialize, specta::Type)]
pub struct ChatMessage {
    pub role: String,
    pub text: String,
    #[serde(default)]
    pub images: Vec<ImageAttachment>,
}

fn ephemeral_cache_control() -> Value {
    json!({"type": CACHE_TYPE_EPHEMERAL})
}

fn image_block(img: &ImageAttachment) -> Value {
    json!({
        "type": "image",
        "source": {"type": "base64", "media_type": img.media_type, "data": img.data}
    })
}

pub fn build_content(text: &str, images: &[ImageAttachment], cache_breakpoint: bool) -> Value {
    if images.is_empty() && !cache_breakpoint {
        return json!(text);
    }
    let mut blocks: Vec<Value> = images.iter().map(image_block).collect();
    if !text.is_empty() {
        blocks.push(json!({"type": "text", "text": text}));
    }
    if blocks.is_empty() {
        return json!(text);
    }
    if cache_breakpoint {
        if let Some(last) = blocks.last_mut() {
            last["cache_control"] = ephemeral_cache_control();
        }
    }
    Value::Array(blocks)
}

fn history_messages_json(messages: &[ChatMessage]) -> Vec<Value> {
    let kept: Vec<&ChatMessage> = messages
        .iter()
        .filter(|m| !m.text.is_empty() || !m.images.is_empty())
        .collect();
    let last = kept.len().saturating_sub(1);
    kept.iter()
        .enumerate()
        .map(|(i, m)| json!({"role": m.role, "content": build_content(&m.text, &m.images, i == last)}))
        .collect()
}

fn system_json(system: &str) -> Value {
    if system.is_empty() {
        json!("")
    } else {
        json!([{"type": "text", "text": system, "cache_control": ephemeral_cache_control()}])
    }
}

pub fn build_count_tokens_body(
    model: &str,
    system: &str,
    messages: &[ChatMessage],
    thinking: Option<Value>,
    web_search: Option<Value>,
) -> Value {
    let mut body = build_request_body(model, system, messages, thinking, web_search);
    if let Some(o) = body.as_object_mut() {
        o.remove("max_tokens");
        o.remove("stream");
    }
    body
}

pub fn build_request_body(
    model: &str,
    system: &str,
    messages: &[ChatMessage],
    thinking: Option<Value>,
    web_search: Option<Value>,
) -> Value {
    let mut body = json!({
        "model": model,
        "max_tokens": MAX_TOKENS,
        "stream": true,
        "system": system_json(system),
        "messages": history_messages_json(messages)
    });
    if let Some(t) = thinking {
        body["thinking"] = t;
    }
    if let Some(tool) = web_search {
        body["tools"] = json!([tool]);
    }
    body
}

#[derive(Debug, Clone, PartialEq)]
pub enum SseOut {
    TextDelta(String),
    InputTokens(u32),
    Done(Option<u32>),
    Retryable(u16, String),
    ApiError(String),
}

pub type SseBlockParser = fn(&str) -> Option<SseOut>;

pub struct SseParser {
    buf: String,
    tail: Vec<u8>,
    parse_block: SseBlockParser,
}

pub(crate) fn sse_data_json(block: &str) -> Option<Value> {
    let data_line = block.lines().find(|l| l.starts_with(SSE_DATA_PREFIX))?;
    serde_json::from_str(&data_line[SSE_DATA_PREFIX.len()..]).ok()
}

impl SseParser {
    pub fn anthropic() -> Self {
        Self::with_block_parser(parse_anthropic_block)
    }

    pub fn with_block_parser(parse_block: SseBlockParser) -> Self {
        Self {
            buf: String::new(),
            tail: Vec::new(),
            parse_block,
        }
    }

    pub fn feed(&mut self, chunk: &str) -> Vec<SseOut> {
        self.buf.push_str(chunk);
        let mut out = Vec::new();
        let mut start = 0;
        while let Some(rel) = self.buf[start..].find(SSE_EVENT_SEPARATOR) {
            let pos = start + rel;
            if let Some(parsed) = (self.parse_block)(&self.buf[start..pos]) {
                out.push(parsed);
            }
            start = pos + SSE_EVENT_SEPARATOR.len();
        }
        self.buf.drain(..start);
        out
    }

    pub fn feed_bytes(&mut self, chunk: &[u8]) -> Vec<SseOut> {
        if self.tail.is_empty() {
            if let Ok(s) = std::str::from_utf8(chunk) {
                return self.feed(s);
            }
        }
        let data = if self.tail.is_empty() {
            chunk.to_vec()
        } else {
            let mut v = std::mem::take(&mut self.tail);
            v.extend_from_slice(chunk);
            v
        };
        match std::str::from_utf8(&data) {
            Ok(s) => self.feed(s),
            Err(e) => {
                let valid = e.valid_up_to();
                let s = std::str::from_utf8(&data[..valid]).expect("проверено valid_up_to");
                let out = self.feed(s);
                // error_len() == None — символ разорван границей чанка, ждём хвост.
                // Some(n) — байты битые: пропускаем их, иначе они остаются в tail
                // навсегда, поток встаёт молча и выглядит как обрыв сети.
                self.tail = match e.error_len() {
                    None => data[valid..].to_vec(),
                    Some(bad) => data[valid + bad..].to_vec(),
                };
                out
            }
        }
    }
}

fn parse_anthropic_block(block: &str) -> Option<SseOut> {
    let v = sse_data_json(block)?;
    match v["type"].as_str()? {
        "content_block_delta" if v["delta"]["type"] == "text_delta" => {
            Some(SseOut::TextDelta(v["delta"]["text"].as_str()?.to_string()))
        }
        "message_start" => {
            let usage = &v["message"]["usage"];
            let total = usage["input_tokens"].as_u64().unwrap_or(0)
                + usage["cache_read_input_tokens"].as_u64().unwrap_or(0)
                + usage["cache_creation_input_tokens"].as_u64().unwrap_or(0);
            (total > 0).then_some(SseOut::InputTokens(total as u32))
        }
        "message_stop" => Some(SseOut::Done(None)),
        "error" => Some(SseOut::ApiError(
            v["error"]["message"]
                .as_str()
                .unwrap_or(UNKNOWN_API_ERROR)
                .to_string(),
        )),
        _ => None,
    }
}

#[cfg(test)]
mod tests;
