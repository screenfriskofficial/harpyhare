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
/// The one table a new vendor is declared in; exported to the frontend.
pub mod registry;
/// The OpenAI Responses dialect.
pub mod responses;
/// Dispatches each request to the vendor that owns the requested model.
pub mod router;

pub const PROVIDER_ANTHROPIC: &str = "anthropic";
pub const PROVIDER_OPENAI: &str = "openai";

/// New chats start here. Paired with `DEFAULT_MODEL` in `lib/chats.ts`,
/// which reads it out of the generated registry rather than repeating it.
pub const DEFAULT_MODEL: &str = "claude-haiku-4-5-20251001";

const ANTHROPIC_BASE_URL: &str = "https://api.anthropic.com";
const MESSAGES_PATH: &str = "/v1/messages";
pub(crate) const MODELS_PATH: &str = "/v1/models";
const MODELS_PAGE_LIMIT: u32 = 100;

pub(crate) const API_KEY_HEADER: &str = "x-api-key";
const VERSION_HEADER: &str = "anthropic-version";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const ANTHROPIC_KEY_LABEL: &str = "Anthropic";

const MAX_TOKENS: u32 = 64000;

const THINKING_ADAPTIVE: &str = "adaptive";
/// Manual extended thinking — the only kind the 4.5 generation without
/// adaptive thinking has (Haiku 4.5, Sonnet 4.5).
const THINKING_ENABLED: &str = "enabled";
/// Under `MAX_TOKENS`, as the API requires, and deep enough to be the
/// «Расширенное рассуждение» claude.ai offers on those models.
const THINKING_BUDGET_TOKENS: u32 = 16_000;
const _: () = assert!(
    THINKING_BUDGET_TOKENS < MAX_TOKENS,
    "the API rejects a budget ≥ max_tokens"
);
/// The level a Claude model reasons at when a request names none, as the
/// documentation states it — the Models API does not report it. The offline
/// table records the models that differ (Opus 5.5 and Haiku 5.5: `medium`).
const ANTHROPIC_DEFAULT_EFFORT: Effort = Effort::High;

/// Web search with dynamic filtering: the 4.6 generation and newer.
const WEB_SEARCH_TOOL_TYPE: &str = "web_search_20260209";
/// The basic tool, for the older models (Haiku 4.5).
const WEB_SEARCH_BASIC_TOOL_TYPE: &str = "web_search_20250305";
const WEB_SEARCH_TOOL_NAME: &str = "web_search";
const WEB_SEARCH_MAX_USES: u32 = 5;
const WEB_SEARCH_DIRECT_CALLERS: [&str; 1] = ["direct"];

const CACHE_TYPE_EPHEMERAL: &str = "ephemeral";

const HAIKU_PREFIX: &str = "claude-haiku";

/// Idle-таймаут чтения стрима — между двумя чанками, а не на весь ответ.
/// Модели с длинным молчаливым рассуждением (gpt-5.5-pro) думают дольше
/// минуты, не присылая ни байта; прежние 60 с роняли
/// такой ответ в «Нет соединения». Мёртвое соединение ловит не он, а
/// http2 keep-alive (интервал + таймаут ниже).
pub(crate) const STREAM_IDLE_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const PROBE_CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
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
    #[error("Сервис ответов перегружен, попробуй позже ({0})")]
    Retryable(u16),
    #[error("Нет соединения — проверь интернет/VPN: {0}")]
    Network(String),
    #[error("Ошибка API: {0}")]
    Api(String),
    /// A 200 whose answer stopped early: the dialect's stop reason, verbatim.
    #[error("Ответ не завершён: {0}")]
    Incomplete(String),
    #[error("Остановлено")]
    Cancelled,
}

impl crate::error::CodedError for LlmError {
    fn code(&self) -> crate::error::ErrorCode {
        use crate::error::ErrorCode;
        match self {
            LlmError::Http(error) => error.code,
            LlmError::BadApiKey(_) => ErrorCode::BadApiKey,
            LlmError::Retryable(status) => crate::error::http::classify(*status, &Value::Null),
            LlmError::Network(_) => ErrorCode::Network,
            LlmError::Api(_) => ErrorCode::Api,
            LlmError::Incomplete(_) => ErrorCode::Incomplete,
            LlmError::Cancelled => ErrorCode::Cancelled,
        }
    }
}

impl crate::error::http::ProviderError for LlmError {
    fn bad_api_key(key_label: &'static str) -> Self {
        LlmError::BadApiKey(key_label)
    }
    fn api(message: String) -> Self {
        LlmError::Api(message)
    }
    fn retryable(status: u16) -> Self {
        LlmError::Retryable(status)
    }
    fn http(failure: crate::error::http::HttpFailure) -> Self {
        LlmError::Http(failure)
    }
    fn network(message: String) -> Self {
        LlmError::Network(message)
    }
}

/// The shared transport policy in this port's terms — see `error::http::transport_error`.
pub(crate) fn network_error(err: reqwest::Error) -> LlmError {
    crate::error::http::transport_error(&err)
}

pub type ModelCatalog = Arc<Mutex<Vec<ModelInfo>>>;

/// How hard a reasoning model works on an answer — one ladder for every
/// vendor. The serialized names are the wire values themselves: Anthropic's
/// `output_config.effort` and the Responses `reasoning.effort` both take these
/// words verbatim, so no vendor needs a translation table. What each model
/// accepts is `ModelInfo.efforts`.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, Deserialize, specta::Type,
)]
#[serde(rename_all = "lowercase")]
pub enum Effort {
    Low,
    Medium,
    High,
    Xhigh,
    Max,
}

impl Effort {
    /// Weakest first — the order the picker shows them in.
    pub const ALL: [Effort; 5] = [
        Effort::Low,
        Effort::Medium,
        Effort::High,
        Effort::Xhigh,
        Effort::Max,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Effort::Low => "low",
            Effort::Medium => "medium",
            Effort::High => "high",
            Effort::Xhigh => "xhigh",
            Effort::Max => "max",
        }
    }
}

/// The level a request carries while the model reasons (asked to, or always
/// does): the chat's own if the model takes it, else the model's default —
/// the one the picker shows checked, so what is checked is what is sent. A
/// model nothing is known about gets no level: an unknown one is a 400 on
/// every request, while sending none is the vendor's own default.
pub fn applicable_effort(
    info: Option<&ModelInfo>,
    reasoning_on: bool,
    effort: Option<Effort>,
) -> Option<Effort> {
    let model = info.filter(|_| reasoning_on)?;
    effort
        .filter(|e| model.efforts.contains(e))
        .or(model.default_effort)
}

#[derive(Debug, Clone, Default, PartialEq, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", default)]
pub struct RequestOptions {
    pub thinking: bool,
    pub web_search: bool,
    /// `None` — the model's default level (`ModelInfo.default_effort`).
    pub effort: Option<Effort>,
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
}

#[async_trait::async_trait]
pub trait LlmProvider: Send + Sync {
    fn provider_id(&self) -> &'static str;
    fn known_models(&self) -> Vec<ModelInfo>;
    /// Берётся ли вендор за модель, которой нет в живом каталоге: последний
    /// резерв роутера перед дефолтным вендором — по офлайн-таблице.
    fn owns_model(&self, model_id: &str) -> bool {
        self.known_models().iter().any(|m| m.id == model_id)
    }
    async fn stream(
        &self,
        request: LlmRequest,
        cancel: CancellationToken,
        sink: &mut dyn LlmStreamSink,
    ) -> Result<(), LlmError>;
    async fn list_models(&self) -> Result<Vec<ModelInfo>, LlmError>;
    /// The catalogue plus WHY a vendor is missing from it. `list_models` alone
    /// let a failed vendor hide behind its offline table: with a stale key the
    /// picker showed last year's models as if they were all there was.
    async fn model_listing(&self) -> ModelListing {
        match self.list_models().await {
            Ok(models) => ModelListing {
                models,
                failures: Vec::new(),
            },
            Err(e) => ModelListing {
                models: Vec::new(),
                failures: vec![CatalogFailure::new(self.provider_id(), &e)],
            },
        }
    }
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
    /// Effort levels the model accepts, weakest first; empty when it takes none.
    pub efforts: Vec<Effort>,
    /// Reasons only through manual extended thinking with a token budget —
    /// an on/off switch, no levels (Haiku 4.5, Sonnet 4.5).
    pub budget_thinking: bool,
    /// The level a request carries when the chat picked none; one of `efforts`.
    pub default_effort: Option<Effort>,
}

/// A vendor whose live catalogue did not come — its models in the picker are
/// then the offline table, and `error` says why.
#[derive(Debug, Clone, PartialEq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CatalogFailure {
    pub provider: String,
    pub error: crate::error::AppError,
}

impl CatalogFailure {
    pub fn new(provider: &str, error: &LlmError) -> Self {
        Self {
            provider: provider.to_string(),
            error: error.into(),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelListing {
    pub models: Vec<ModelInfo>,
    pub failures: Vec<CatalogFailure>,
}

fn fallback_adaptive(id: &str) -> bool {
    !id.starts_with(HAIKU_PREFIX)
}

fn fallback_code_exec(id: &str) -> bool {
    !id.starts_with(HAIKU_PREFIX)
}

/// `capabilities.effort.<level>.supported` — the Models API reports every
/// level separately (Opus 4.6 has no `xhigh`, Haiku 4.5 has none at all), so
/// the picker never needs a list of names.
fn efforts_from_capabilities(capabilities: &Value) -> Vec<Effort> {
    Effort::ALL
        .into_iter()
        .filter(|e| capabilities["effort"][e.as_str()]["supported"].as_bool() == Some(true))
        .collect()
}

/// The documented default, unless the offline table records the model's own.
fn anthropic_default_effort(id: &str, efforts: &[Effort]) -> Option<Effort> {
    let recorded = registry::catalog_models(PROVIDER_ANTHROPIC)
        .into_iter()
        .find(|m| m.id == id)
        .and_then(|m| m.default_effort);
    recorded
        .or(Some(ANTHROPIC_DEFAULT_EFFORT))
        .filter(|e| efforts.contains(e))
}

/// Everything about reasoning comes from `capabilities.thinking.types` and
/// `capabilities.effort` — no list of model names. As on claude.ai, a model
/// with effort levels offers only those levels: it always reasons, and the
/// level is the one control. `disabled` is never sent, so neither the
/// models that refuse it (Opus 5.5, Sonnet 5.5, Fable) nor the ones that take
/// it only up to `high` (Opus 5, Haiku 5.5) can fail on it.
fn model_info_from_json(v: &Value) -> Option<ModelInfo> {
    let id = v["id"].as_str()?.to_string();
    let display_name = v["display_name"].as_str().unwrap_or(&id).to_string();
    let capabilities = &v["capabilities"];
    let thinking = &capabilities["thinking"]["types"];
    let adaptive = thinking["adaptive"]["supported"]
        .as_bool()
        .unwrap_or_else(|| fallback_adaptive(&id));
    let budget_thinking = !adaptive && thinking["enabled"]["supported"].as_bool() == Some(true);
    let code_exec = capabilities["code_execution"]["supported"]
        .as_bool()
        .unwrap_or_else(|| fallback_code_exec(&id));
    let efforts = efforts_from_capabilities(capabilities);
    let cannot_stop = thinking["disabled"]["supported"].as_bool() == Some(false);
    Some(ModelInfo {
        always_thinks: (adaptive || budget_thinking) && (!efforts.is_empty() || cannot_stop),
        provider: PROVIDER_ANTHROPIC.into(),
        adaptive,
        code_exec,
        default_effort: anthropic_default_effort(&id, &efforts),
        efforts,
        budget_thinking,
        id,
        display_name,
    })
}

pub fn fallback_models() -> Vec<ModelInfo> {
    registry::catalog_models(PROVIDER_ANTHROPIC)
}

/// Explicit even where it is the default: Opus 4.6 and Sonnet 4.6 run
/// thinking-off when the field is omitted. «Off» is the field left out — the
/// models that reason through a budget do not think by default, and every
/// other model offers no «off» at all (see `model_info_from_json`).
pub fn thinking_value(info: Option<&ModelInfo>, model_id: &str, requested: bool) -> Option<Value> {
    let Some(m) = info else {
        return (requested && fallback_adaptive(model_id))
            .then(|| json!({"type": THINKING_ADAPTIVE}));
    };
    if !(requested || m.always_thinks) {
        return None;
    }
    if m.adaptive {
        Some(json!({"type": THINKING_ADAPTIVE}))
    } else if m.budget_thinking {
        Some(json!({"type": THINKING_ENABLED, "budget_tokens": THINKING_BUDGET_TOKENS}))
    } else {
        None
    }
}

/// The level of the request, while the model reasons: the chat's own or the
/// model's default. Without a live catalogue the offline one vouches for the
/// level; a model neither knows is sent none.
pub fn effort_config_value(
    info: Option<&ModelInfo>,
    model_id: &str,
    options: &RequestOptions,
) -> Option<Value> {
    let offline = info
        .is_none()
        .then(|| fallback_models().into_iter().find(|m| m.id == model_id))
        .flatten();
    let info = info.or(offline.as_ref());
    let always = info.is_some_and(|m| m.always_thinks);
    applicable_effort(info, options.thinking || always, options.effort)
        .map(|effort| json!({"effort": effort}))
}

/// The tool version follows the model generation, and the Models API has no
/// field for it: dynamic filtering arrived with the 4.6 generation, the same
/// one that brought adaptive thinking, so `adaptive` stands in for it.
/// `code_execution` alone is not the test — Haiku 4.5 reports it, yet without
/// `allowed_callers` the dynamic tool answered every Haiku request with a 400.
pub fn web_search_value(
    info: Option<&ModelInfo>,
    model_id: &str,
    requested: bool,
) -> Option<Value> {
    if !requested {
        return None;
    }
    let dynamic = info.map_or_else(|| fallback_adaptive(model_id), |m| m.adaptive);
    let code_exec = info.map_or_else(|| fallback_code_exec(model_id), |m| m.code_exec);
    let mut tool = json!({
        "type": if dynamic { WEB_SEARCH_TOOL_TYPE } else { WEB_SEARCH_BASIC_TOOL_TYPE },
        "name": WEB_SEARCH_TOOL_NAME,
        "max_uses": WEB_SEARCH_MAX_USES
    });
    // Dynamic filtering runs code execution under the hood; a model without
    // it has to call the tool directly.
    if dynamic && !code_exec {
        tool["allowed_callers"] = json!(WEB_SEARCH_DIRECT_CALLERS);
    }
    Some(tool)
}

/// Что отличает пул одного вендора от пула другого.
#[derive(Debug, Clone, Copy)]
pub(crate) struct HttpClientOptions {
    pub read_timeout: Duration,
}

impl Default for HttpClientOptions {
    fn default() -> Self {
        Self {
            read_timeout: STREAM_IDLE_TIMEOUT,
        }
    }
}

pub(crate) fn build_http_client(options: HttpClientOptions) -> reqwest::Client {
    crate::net::pooled_client_builder()
        .read_timeout(options.read_timeout)
        .build()
        .expect("reqwest client")
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
            .user_agent(crate::net::APP_USER_AGENT)
            .connect_timeout(PROBE_CONNECT_TIMEOUT)
            .timeout(crate::net::WARM_UP_TIMEOUT)
            .pool_max_idle_per_host(0)
            .http1_only()
            .build()
            .expect("probe reqwest client")
    })
}

pub(crate) async fn require_ok_status(
    resp: reqwest::Response,
    key_label: &'static str,
) -> Result<reqwest::Response, LlmError> {
    if resp.status().is_success() {
        Ok(resp)
    } else {
        Err(crate::error::http::provider_error(
            crate::error::http::failure(resp).await,
            key_label,
        ))
    }
}

/// Качает SSE-ответ в `sink`. Конец потока без терминального события диалекта
/// (`Done`) — обрыв, а не успех: usage у части вендоров приходит только в
/// конце, и «тихий» EOF означал бы либо потерянные токены, либо `Ok` из
/// реально оборванного ответа.
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
        let bytes = chunk.map_err(network_error)?;
        for out in parser.feed_bytes(&bytes) {
            match out {
                SseOut::TextDelta(t) => sink.text_delta(&t),
                SseOut::Done => return Ok(()),
                SseOut::ApiError(m) => return Err(LlmError::Api(m)),
                SseOut::Incomplete(reason) => return Err(LlmError::Incomplete(reason)),
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

    fn capability_fields(
        &self,
        request: &LlmRequest,
    ) -> (Option<Value>, Option<Value>, Option<Value>) {
        let info = self.cached_model(&request.model);
        let thinking = request.options.thinking;
        (
            thinking_value(info.as_ref(), &request.model, thinking),
            effort_config_value(info.as_ref(), &request.model, &request.options),
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
        let (thinking, output_config, web_search) = self.capability_fields(&request);
        let mut body = build_request_body(
            &request.model,
            &request.system,
            &request.messages,
            thinking,
            web_search,
        );
        if let Some(config) = output_config {
            body["output_config"] = config;
        }
        self.stream_message(body, cancel, sink).await
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

impl ImageAttachment {
    /// The `data:` URL every OpenAI-shaped dialect takes an image in.
    pub fn data_url(&self) -> String {
        format!("data:{};base64,{}", self.media_type, self.data)
    }
}

#[derive(Debug, Clone, Deserialize, specta::Type)]
pub struct ChatMessage {
    pub role: String,
    pub text: String,
    #[serde(default)]
    pub images: Vec<ImageAttachment>,
}

impl ChatMessage {
    /// Neither text nor images. Every API rejects such a turn, so the body
    /// builders drop it from the history instead of sending it.
    pub fn is_empty(&self) -> bool {
        self.text.is_empty() && self.images.is_empty()
    }
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
    let kept: Vec<&ChatMessage> = messages.iter().filter(|m| !m.is_empty()).collect();
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
    /// The dialect's terminal event (`message_stop`, `response.completed`).
    Done,
    ApiError(String),
    /// The answer stopped before its end. The text streamed so far is shown in
    /// a chat, but a pipeline step must not pass it on as a finished result.
    Incomplete(String),
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

/// Length of the line ending at `at`: `\n`, `\r\n` or a lone `\r`.
fn line_ending_len(bytes: &[u8], at: usize) -> Option<usize> {
    match bytes.get(at)? {
        b'\n' => Some(1),
        b'\r' if bytes.get(at + 1) == Some(&b'\n') => Some(2),
        b'\r' => Some(1),
        _ => None,
    }
}

/// Offset and length of the first event separator in the buffer: per the
/// spec, two consecutive line endings in any combination (`\n\n`, `\r\n\r\n`,
/// `\r\r`, and the mixed `\n\r\n` and `\r\n\n`).
fn find_sse_separator(bytes: &[u8]) -> Option<(usize, usize)> {
    let mut at = 0;
    while at < bytes.len() {
        let Some(first) = line_ending_len(bytes, at) else {
            at += 1;
            continue;
        };
        if let Some(second) = line_ending_len(bytes, at + first) {
            return Some((at, first + second));
        }
        at += first;
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
    let code = crate::error::http::classify(status, &json!({"error": error}));
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
        // `max_tokens` and `model_context_window_exceeded` truncate; `refusal`
        // stops for safety; `pause_turn` (server tools) and `tool_use` hand
        // the turn back to a client that would have to continue it — this
        // client does not, so the answer is what has arrived so far.
        Some("message_delta") => match v["delta"]["stop_reason"].as_str() {
            Some("end_turn" | "stop_sequence") | None => None,
            Some(reason) => Some(SseOut::Incomplete(format!("Anthropic: {reason}"))),
        },
        Some("message_stop") => Some(SseOut::Done),
        Some("error") => Some(anthropic_error_out(&v["error"])),
        _ => None,
    };
    out.into_iter().collect()
}

#[cfg(test)]
pub(crate) mod test_support;
#[cfg(test)]
mod tests;
