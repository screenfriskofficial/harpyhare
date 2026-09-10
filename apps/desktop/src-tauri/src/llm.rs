//! The LLM port and the Anthropic client.
//!
//! Adding a vendor touches three places and none of them is here: a row in
//! `registry`, a module beside `responses`, and one arm in
//! `app_state::build_provider`. See «Как добавить нового LLM-вендора» in
//! `apps/desktop/CLAUDE.md`.

use crate::sync::LockUnpoisoned;
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex, OnceLock};
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
/// OpenAI-compatible Chat Completions as spoken by the Xclis aggregator.
pub mod xclis;

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

pub(crate) const API_KEY_HEADER: &str = "x-api-key";
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
/// Idle-таймаут чтения стрима — между двумя чанками, а не на весь ответ.
/// Модели с длинным молчаливым рассуждением (gpt-5.5-pro, часть моделей
/// Xclis) думают дольше минуты, не присылая ни байта; прежние 60 с роняли
/// такой ответ в «Нет соединения». Мёртвое соединение ловит не он, а
/// http2 keep-alive (интервал + таймаут ниже).
pub(crate) const STREAM_IDLE_TIMEOUT: Duration = Duration::from_secs(5 * 60);
/// Общий таймаут коротких JSON-вызовов (count_tokens, каталог): без него
/// они наследовали бы пятиминутный idle стрима.
pub(crate) const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const HTTP2_KEEP_ALIVE_INTERVAL: Duration = Duration::from_secs(30);
const HTTP2_KEEP_ALIVE_TIMEOUT: Duration = Duration::from_secs(5);
const PROBE_CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
pub(crate) const WARM_UP_TIMEOUT: Duration = Duration::from_secs(5);
pub(crate) const LIST_MODELS_TIMEOUT: Duration = Duration::from_secs(15);

const SSE_DATA_FIELD: &str = "data:";

const TRUNCATED_STREAM_ERROR: &str = "ответ оборван до завершения";
pub(crate) const UNKNOWN_API_ERROR: &str = "неизвестная ошибка API";

/// `error.type` Anthropic внутри 200-стрима, при которых повтор имеет смысл,
/// и HTTP-эквивалент для `LlmError::Retryable`: перегрузка приходит именно
/// так, событием, а не статусом, и без этой таблицы уезжала кодом `api`
/// — без кнопки «Повторить» ровно там, где она нужна.
const ANTHROPIC_RETRYABLE_ERROR_TYPES: [(&str, u16); 3] = [
    ("overloaded_error", 529),
    ("rate_limit_error", 429),
    ("api_error", 500),
];

#[derive(Debug, thiserror::Error)]
pub enum LlmError {
    #[error(transparent)]
    Http(#[from] crate::error::http::HttpFailure),
    #[error("Неверный ключ {0} — проверь в настройках")]
    BadApiKey(&'static str),
    /// 401/403 от relay: код доступа недействителен или исчерпан. Текст — от
    /// самого relay, он знает причину. Симметрично `SttError::BadAccessCode`.
    #[error("{0}")]
    BadAccessCode(String),
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
            LlmError::Http(error) => error.code,
            LlmError::BadApiKey(_) => ErrorCode::BadApiKey,
            LlmError::BadAccessCode(_) => ErrorCode::BadAccessCode,
            LlmError::Retryable(status) => {
                crate::error::http::classify(*status, &Value::Null, false)
            }
            LlmError::Network(_) => ErrorCode::Network,
            LlmError::Api(_) => ErrorCode::Api,
            LlmError::Cancelled => ErrorCode::Cancelled,
        }
    }
}

fn http_failure(error: crate::error::http::HttpFailure, key_label: &'static str) -> LlmError {
    use crate::error::ErrorCode;
    match error.code {
        ErrorCode::BadApiKey => LlmError::BadApiKey(key_label),
        ErrorCode::BadAccessCode => LlmError::BadAccessCode(error.message),
        ErrorCode::Api => LlmError::Api(error.message),
        ErrorCode::RateLimited | ErrorCode::ServiceUnavailable | ErrorCode::Timeout => {
            LlmError::Retryable(error.status)
        }
        _ => LlmError::Http(error),
    }
}

/// Сетевая ошибка с цепочкой причин: reqwest в `Display` прячет источник
/// («error sending request»), а пользователю и логам нужен именно он —
/// таймаут это, отказ TLS или DNS.
pub(crate) fn network_error(err: reqwest::Error) -> LlmError {
    if err.is_timeout() {
        return LlmError::Retryable(408);
    }
    let kind = if err.is_timeout() {
        "таймаут"
    } else if err.is_connect() {
        "ошибка подключения"
    } else if err.is_body() || err.is_decode() {
        "ошибка чтения ответа"
    } else {
        "ошибка запроса"
    };
    let mut details = vec![err.to_string()];
    let mut source = std::error::Error::source(&err);
    while let Some(cause) = source {
        let text = cause.to_string();
        if !text.trim().is_empty() && !details.contains(&text) {
            details.push(text);
        }
        source = cause.source();
    }
    LlmError::Network(format!("{kind}: {}", details.join(": ")))
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
    /// Берётся ли вендор за модель, которой нет ни в живом каталоге, ни в его
    /// офлайн-таблице. По умолчанию — только за известные; агрегатор со своим
    /// неймспейсом (`xclis/…`) отвечает по префиксу, иначе после холодного
    /// старта его модели уезжали бы к первому вендору роутера.
    fn owns_model(&self, model_id: &str) -> bool {
        self.known_models().iter().any(|m| m.id == model_id)
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
pub(crate) const ANTHROPIC_HEADERS: http::StaticHeaders = &[(VERSION_HEADER, ANTHROPIC_VERSION)];

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

/// Что отличает пул одного вендора от пула другого.
#[derive(Debug, Clone, Copy)]
pub(crate) struct HttpClientOptions {
    pub read_timeout: Duration,
    /// Ходить ли через системный прокси. Xclis намеренно идёт мимо него.
    pub system_proxy: bool,
}

impl Default for HttpClientOptions {
    fn default() -> Self {
        Self {
            read_timeout: STREAM_IDLE_TIMEOUT,
            system_proxy: true,
        }
    }
}

pub(crate) fn build_http_client(options: HttpClientOptions) -> reqwest::Client {
    crate::tls::ensure_crypto_provider();
    let mut builder = reqwest::Client::builder()
        .user_agent(APP_USER_AGENT)
        .connect_timeout(CONNECT_TIMEOUT)
        .read_timeout(options.read_timeout)
        .pool_idle_timeout(None)
        .http2_keep_alive_interval(HTTP2_KEEP_ALIVE_INTERVAL)
        .http2_keep_alive_timeout(HTTP2_KEEP_ALIVE_TIMEOUT)
        .http2_keep_alive_while_idle(true);
    if !options.system_proxy {
        builder = builder.no_proxy();
    }
    builder.build().expect("reqwest client")
}

/// Клиент проб связи: короткие таймауты, без пула (`pool_max_idle_per_host(0)`),
/// иначе проба паркуется за мёртвым keep-alive-соединением и висит куда дольше
/// своего таймаута. Один на процесс: раньше он собирался заново на КАЖДУЮ
/// пробу, то есть каждые несколько секунд в офлайне на каждого вендора.
pub(crate) fn probe_http_client() -> &'static reqwest::Client {
    static PROBE: OnceLock<reqwest::Client> = OnceLock::new();
    PROBE.get_or_init(|| {
        crate::tls::ensure_crypto_provider();
        reqwest::Client::builder()
            .user_agent(APP_USER_AGENT)
            .connect_timeout(PROBE_CONNECT_TIMEOUT)
            .timeout(WARM_UP_TIMEOUT)
            .pool_max_idle_per_host(0)
            .http1_only()
            .build()
            .expect("probe reqwest client")
    })
}

pub(crate) async fn require_ok_status(
    resp: reqwest::Response,
    key_label: &'static str,
    proxy: bool,
) -> Result<reqwest::Response, LlmError> {
    if resp.status().is_success() {
        Ok(resp)
    } else {
        Err(http_failure(
            crate::error::http::failure(resp, proxy).await,
            key_label,
        ))
    }
}

const ERROR_BODY_SNIPPET_CHARS: usize = 120;

/// Текст ошибки из тела ответа любого вендора: `error.message` (Anthropic,
/// OpenAI, relay), `err_msg` (Deepgram) или `message`; без JSON — сниппет тела.
/// Один разбор на LLM и STT — раньше их было три, и у одного не-JSON тело
/// выбрасывалось целиком.
pub(crate) async fn api_error_message(resp: reqwest::Response, code: u16) -> String {
    let body = resp.text().await.unwrap_or_default();
    serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|v| {
            v["error"]["message"]
                .as_str()
                .or_else(|| v["err_msg"].as_str())
                .or_else(|| v["message"].as_str())
                .map(str::trim)
                .filter(|m| !m.is_empty())
                .map(str::to_string)
        })
        .unwrap_or_else(|| {
            let snippet: String = body.trim().chars().take(ERROR_BODY_SNIPPET_CHARS).collect();
            if snippet.is_empty() {
                format!("HTTP {code}")
            } else {
                format!("HTTP {code}: {snippet}")
            }
        })
}

/// Качает SSE-ответ в `sink`. Конец потока без терминального события диалекта
/// (`Done`) — обрыв, а не успех: usage у части вендоров приходит только в
/// конце, и «тихий» EOF означал бы либо потерянные токены, либо `Ok` из
/// реально оборванного ответа. Единственное исключение — диалект, у которого
/// конец ответа объявляется раньше терминального события (`Finished`): после
/// него EOF штатен.
pub(crate) async fn pump_sse_stream(
    resp: reqwest::Response,
    mut parser: SseParser,
    cancel: &CancellationToken,
    sink: &mut dyn LlmStreamSink,
) -> Result<(), LlmError> {
    let mut stream = resp.bytes_stream();
    let mut finished = false;
    loop {
        let chunk = tokio::select! {
            c = stream.next() => c,
            _ = cancel.cancelled() => return Err(LlmError::Cancelled),
        };
        let Some(chunk) = chunk else {
            return if finished {
                Ok(())
            } else {
                Err(LlmError::Network(TRUNCATED_STREAM_ERROR.into()))
            };
        };
        let bytes = chunk.map_err(network_error)?;
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
                SseOut::Finished => finished = true,
                SseOut::ApiError(m) => return Err(LlmError::Api(m)),
                SseOut::HttpError(error) => return Err(LlmError::Http(error)),
                SseOut::Retryable { code, .. } => return Err(LlmError::Retryable(code)),
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
            .lock_unpoisoned()
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

    /// Каталог только ЧИТАЕТСЯ отсюда (`capability_fields`); пишет его роутер,
    /// сливая ответы всех вендоров. Запись отсюда затирала общий каталог
    /// одними моделями Anthropic на время, пока роутер ждёт остальных.
    async fn list_models(&self) -> Result<Vec<ModelInfo>, LlmError> {
        self.fetch_models().await
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
    /// Терминальное событие диалекта. Usage внутри — для вендоров, которые
    /// сообщают его только в конце (Responses: `response.completed`).
    Done(Option<u32>),
    /// Диалект объявил конец ответа, но его терминальное событие ещё впереди
    /// или его нет вовсе (Chat Completions: `finish_reason`, затем usage-чанк
    /// и `[DONE]`). Поток читается дальше; EOF после этого — штатный конец.
    Finished,
    ApiError(String),
    HttpError(crate::error::http::HttpFailure),
    /// Ошибка внутри 200-стрима, при которой стоит повторить (перегрузка,
    /// лимит). `code` — HTTP-эквивалент для `LlmError::Retryable`.
    Retryable {
        code: u16,
        message: String,
    },
}

/// Разбор одного события: на вход — склеенная полезная нагрузка `data:`.
pub type SseBlockParser = fn(&str) -> Vec<SseOut>;

/// Фреймер SSE по спецификации, общий для всех диалектов.
///
/// Событие заканчивается пустой строкой (`\n\n`, `\r\n\r\n` или `\r\r`);
/// полезная нагрузка — все строки `data:` события (пробел после двоеточия
/// необязателен), склеенные через `\n`; `event:`, `id:`, `retry:` и
/// комментарии пропускаются. Буфер байтовый: разделители — ASCII, поэтому
/// многобайтовый символ, разрезанный сетевым чанком, дожидается своего
/// хвоста внутри события сам, без отдельной UTF-8-склейки. Блок-парсер
/// диалекта получает уже склеенную нагрузку, а не сырой блок.
pub struct SseParser {
    buffer: Vec<u8>,
    search_from: usize,
    parse_block: SseBlockParser,
}

pub(crate) fn sse_data_json(data: &str) -> Option<Value> {
    serde_json::from_str(data).ok()
}

impl SseParser {
    pub fn anthropic() -> Self {
        Self::with_block_parser(parse_anthropic_block)
    }

    pub fn with_block_parser(parse_block: SseBlockParser) -> Self {
        Self {
            buffer: Vec::new(),
            search_from: 0,
            parse_block,
        }
    }

    pub fn feed(&mut self, chunk: &str) -> Vec<SseOut> {
        self.feed_bytes(chunk.as_bytes())
    }

    pub fn feed_bytes(&mut self, chunk: &[u8]) -> Vec<SseOut> {
        self.buffer.extend_from_slice(chunk);
        let mut out = Vec::new();
        let mut consumed = 0;
        while let Some((offset, separator_len)) =
            find_sse_separator(&self.buffer[self.search_from..])
        {
            let end = self.search_from + offset;
            let payload = sse_event_data(&self.buffer[consumed..end]);
            consumed = end + separator_len;
            self.search_from = consumed;
            if !payload.is_empty() {
                out.extend((self.parse_block)(&payload));
            }
        }
        // Compact once per network chunk, rather than shifting the remaining
        // bytes once per event. Only a split separator needs to be rescanned.
        self.buffer.drain(..consumed);
        const LONGEST_SEPARATOR: usize = 4;
        self.search_from = self.buffer.len().saturating_sub(LONGEST_SEPARATOR - 1);
        out
    }
}

/// Позиция и длина первого разделителя событий в буфере.
fn find_sse_separator(bytes: &[u8]) -> Option<(usize, usize)> {
    for i in 0..bytes.len() {
        match bytes[i] {
            b'\n' if bytes.get(i + 1) == Some(&b'\n') => return Some((i, 2)),
            b'\r' => {
                if bytes.get(i + 1) == Some(&b'\n')
                    && bytes.get(i + 2) == Some(&b'\r')
                    && bytes.get(i + 3) == Some(&b'\n')
                {
                    return Some((i, 4));
                }
                if bytes.get(i + 1) == Some(&b'\r') {
                    return Some((i, 2));
                }
            }
            _ => {}
        }
    }
    None
}

/// Склеенная нагрузка `data:`-строк одного события.
fn sse_event_data(event: &[u8]) -> String {
    let text = String::from_utf8_lossy(event);
    let mut data = String::new();
    let mut has_data = false;
    for line in text.split(['\n', '\r']) {
        let Some(value) = line.strip_prefix(SSE_DATA_FIELD) else {
            continue;
        };
        let value = value.strip_prefix(' ').unwrap_or(value);
        if has_data {
            data.push('\n');
        }
        has_data = true;
        data.push_str(value);
    }
    data
}

fn anthropic_error_out(error: &Value) -> SseOut {
    let message = error["message"]
        .as_str()
        .unwrap_or(UNKNOWN_API_ERROR)
        .to_string();
    let kind = error["type"].as_str().unwrap_or_default();
    match ANTHROPIC_RETRYABLE_ERROR_TYPES
        .iter()
        .find(|(t, _)| *t == kind)
    {
        Some((_, code)) => SseOut::Retryable {
            code: *code,
            message,
        },
        None => classified_stream_error(200, error, message),
    }
}

fn classified_stream_error(status: u16, error: &Value, message: String) -> SseOut {
    let code = crate::error::http::classify(status, &json!({"error": error}), false);
    if code == crate::error::ErrorCode::Api {
        SseOut::ApiError(message)
    } else {
        SseOut::HttpError(crate::error::http::HttpFailure {
            status,
            code,
            message,
        })
    }
}

fn parse_anthropic_block(data: &str) -> Vec<SseOut> {
    let Some(v) = sse_data_json(data) else {
        return Vec::new();
    };
    let out = match v["type"].as_str() {
        Some("content_block_delta") if v["delta"]["type"] == "text_delta" => v["delta"]["text"]
            .as_str()
            .map(|t| SseOut::TextDelta(t.to_string())),
        Some("message_start") => {
            let usage = &v["message"]["usage"];
            let total = usage["input_tokens"].as_u64().unwrap_or(0)
                + usage["cache_read_input_tokens"].as_u64().unwrap_or(0)
                + usage["cache_creation_input_tokens"].as_u64().unwrap_or(0);
            (total > 0).then_some(SseOut::InputTokens(total as u32))
        }
        Some("message_stop") => Some(SseOut::Done(None)),
        Some("error") => Some(anthropic_error_out(&v["error"])),
        _ => None,
    };
    out.into_iter().collect()
}

#[cfg(test)]
mod tests;
