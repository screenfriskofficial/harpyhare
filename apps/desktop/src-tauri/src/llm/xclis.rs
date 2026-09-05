//! Xclis — агрегатор чужих моделей под своим ключом, говорящий на
//! OpenAI-совместимом Chat Completions (`POST /v1/chat/completions`), а НЕ на
//! Responses: диалект другой, поэтому и модуль отдельный. Рассуждение здесь
//! кодируется не полем, а суффиксом `-thinking` у имени модели.
//!
//! Транспорт общий — `LlmHttp` и `SseParser`; своего здесь ровно три вещи:
//! тело запроса, разбор чанков Chat Completions и динамический каталог с
//! бесплатной пробой «обслуживает ли группа модель».

use crate::sync::LockUnpoisoned;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio_util::sync::CancellationToken;

use super::http::{Credential, LlmHttp};
use super::registry::{catalog_models, LlmProviderSpec};
use super::{
    network_error, pump_sse_stream, ChatMessage, HttpClientOptions, LlmError,
    LlmProvider, LlmRequest, LlmStreamSink, ModelCatalog, ModelInfo, SseOut, SseParser,
    ANTHROPIC_HEADERS, API_KEY_HEADER, LIST_MODELS_TIMEOUT, MODELS_PATH, STREAM_IDLE_TIMEOUT,
};

pub const PROVIDER_XCLIS: &str = "xclis";
/// Неймспейс приложения, а не имя модели вендора: `xclis/claude-opus-4-6`.
/// По нему роутер узнаёт владельца модели даже до прихода живого каталога.
pub const MODEL_PREFIX: &str = "xclis/";

const CHAT_COMPLETIONS_PATH: &str = "/v1/chat/completions";
const COUNT_TOKENS_PATH: &str = "/v1/messages/count_tokens";
const MAX_TOKENS: u32 = 32768;
const ERROR_BODY_CHARS: usize = 500;
const THINKING_SUFFIX: &str = "-thinking";
/// Текст, которым Xclis отказывается обслуживать объявленную им же модель.
const MODEL_REJECTED_MARKER: &str = "not supported by any configured account";
const EVENT_STREAM_MIME: &str = "text/event-stream";
const DONE_SENTINEL: &str = "[DONE]";
/// Сколько живёт вердикт пробы «обслуживает ли группа модель». Пробы шли на
/// КАЖДЫЙ `list_models` — при старте и при каждом монтировании HUD, по
/// запросу на модель; состав группы меняется куда реже.
const VERDICT_TTL: Duration = Duration::from_secs(10 * 60);

#[derive(Clone, Copy)]
struct Verdict {
    served: bool,
    at: Instant,
}

impl Verdict {
    fn fresh(&self) -> bool {
        self.at.elapsed() < VERDICT_TTL
    }
}

fn snippet(text: &str) -> String {
    text.chars().take(ERROR_BODY_CHARS).collect()
}

fn prompt_tokens(v: &Value) -> Option<u32> {
    v["usage"]["prompt_tokens"]
        .as_u64()
        .or_else(|| v["usage"]["input_tokens"].as_u64())
        .filter(|n| *n > 0)
        .map(|n| n as u32)
}

fn content_text(content: &Value) -> Option<String> {
    if let Some(text) = content.as_str() {
        return Some(text.to_string());
    }
    let items = content.as_array()?;
    Some(
        items
            .iter()
            .filter_map(|item| item["text"].as_str().or_else(|| item["content"].as_str()))
            .collect::<Vec<_>>()
            .join(""),
    )
}

/// Разбор одного события Chat Completions. Терминальное событие диалекта —
/// `[DONE]`; `finish_reason` лишь объявляет конец ответа (`Finished`), потому
/// что usage-чанк с `include_usage` приходит ПОСЛЕ него, и остановка на
/// `finish_reason` теряла бы токены.
pub fn parse_block(data: &str) -> Vec<SseOut> {
    if data.trim() == DONE_SENTINEL {
        return vec![SseOut::Done(None)];
    }
    let v = match serde_json::from_str::<Value>(data) {
        Ok(v) => v,
        Err(e) => {
            return vec![SseOut::ApiError(format!(
                "Xclis вернул некорректный SSE JSON: {e}; {}",
                snippet(data)
            ))]
        }
    };
    if let Some(message) = v["error"]["message"].as_str() {
        return vec![SseOut::ApiError(format!("Xclis: {message}"))];
    }
    let mut out = Vec::new();
    if let Some(tokens) = prompt_tokens(&v) {
        out.push(SseOut::InputTokens(tokens));
    }
    let choice = &v["choices"][0];
    if let Some(text) = content_text(&choice["delta"]["content"]) {
        if !text.is_empty() {
            out.push(SseOut::TextDelta(text));
        }
    }
    if choice["finish_reason"].is_string() {
        out.push(SseOut::Finished);
    }
    out
}

#[derive(Clone)]
pub struct XclisClient {
    spec: &'static LlmProviderSpec,
    /// Chat Completions: bearer.
    chat: LlmHttp,
    /// Каталог и счётчик токенов у Xclis сделаны по образу Anthropic:
    /// `x-api-key` и `anthropic-version`. Тот же пул, другой ключ.
    anthropic: LlmHttp,
    /// Общий каталог приложения (пишет роутер). Отсюда берётся, есть ли у
    /// модели живой `-thinking`-двойник; приватная копия у клиента терялась
    /// при каждой пересборке клиента вместе с тумблером рассуждения.
    catalog: ModelCatalog,
    /// Вердикты проб «обслуживает ли группа модель» и отказы, пришедшие уже
    /// в бою. Читается и `served_ids`, и пикером: отказанная модель не
    /// перепробуется и не предлагается, пока вердикт свеж.
    verdicts: Arc<Mutex<HashMap<String, Verdict>>>,
}

impl XclisClient {
    pub fn new(spec: &'static LlmProviderSpec, api_key: String) -> Self {
        let base_url = spec.wire.base_url().trim_end_matches('/').to_string();
        let chat = LlmHttp::with_options(
            base_url,
            Credential::Bearer(api_key.clone()),
            spec.wire.key_label(),
            HttpClientOptions { read_timeout: STREAM_IDLE_TIMEOUT, system_proxy: false },
        );
        let anthropic = chat
            .clone()
            .with_credential(Credential::ApiKeyHeader { header: API_KEY_HEADER, key: api_key })
            .with_headers(ANTHROPIC_HEADERS);
        Self {
            spec,
            chat,
            anthropic,
            catalog: Arc::new(Mutex::new(Vec::new())),
            verdicts: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn with_catalog(mut self, catalog: ModelCatalog) -> Self {
        self.catalog = catalog;
        self
    }

    pub fn with_base_url(mut self, url: String) -> Self {
        let url = url.trim_end_matches('/').to_string();
        self.chat = self.chat.with_base_url(url.clone());
        self.anthropic = self.anthropic.with_base_url(url);
        self
    }

    fn upstream_id(model_id: &str) -> &str {
        model_id.strip_prefix(MODEL_PREFIX).unwrap_or(model_id)
    }

    fn app_id(upstream_id: &str) -> String {
        format!("{MODEL_PREFIX}{upstream_id}")
    }

    fn selected_model(&self, requested: &str, thinking: bool) -> String {
        let requested = Self::upstream_id(requested);
        if thinking {
            if requested.ends_with(THINKING_SUFFIX) {
                return requested.to_string();
            }
            let app_id = Self::app_id(requested);
            let live_capability = {
                let catalog = self.catalog.lock_unpoisoned();
                catalog.iter().find(|m| m.id == app_id).map(|m| m.adaptive)
            };
            let supports_thinking = live_capability.unwrap_or_else(|| {
                catalog_models(PROVIDER_XCLIS)
                    .iter()
                    .find(|m| m.id == app_id)
                    .is_some_and(|m| m.adaptive)
            });
            if supports_thinking {
                return format!("{requested}{THINKING_SUFFIX}");
            }
        } else if let Some(base) = requested.strip_suffix(THINKING_SUFFIX) {
            return base.to_string();
        }
        requested.to_string()
    }

    fn openai_content(message: &ChatMessage) -> Value {
        if message.images.is_empty() {
            return json!(message.text);
        }
        let mut blocks = Vec::with_capacity(message.images.len() + 1);
        for image in &message.images {
            blocks.push(json!({
                "type": "image_url",
                "image_url": {
                    "url": format!("data:{};base64,{}", image.media_type, image.data)
                }
            }));
        }
        if !message.text.is_empty() {
            blocks.push(json!({"type": "text", "text": message.text}));
        }
        Value::Array(blocks)
    }

    fn chat_messages(request: &LlmRequest) -> Vec<Value> {
        let mut messages = Vec::with_capacity(request.messages.len() + 1);
        if !request.system.trim().is_empty() {
            messages.push(json!({"role": "system", "content": request.system}));
        }
        messages.extend(
            request
                .messages
                .iter()
                .filter(|m| !m.text.is_empty() || !m.images.is_empty())
                .map(|m| json!({"role": m.role, "content": Self::openai_content(m)})),
        );
        messages
    }

    fn chat_body(&self, request: &LlmRequest) -> Result<Value, LlmError> {
        if request.options.web_search {
            return Err(LlmError::Api(
                "Xclis: встроенный web-search не документирован для /v1/chat/completions; выключи «Веб-поиск» или выбери другого провайдера".into(),
            ));
        }
        Ok(json!({
            "model": self.selected_model(&request.model, request.options.thinking),
            "messages": Self::chat_messages(request),
            "max_tokens": MAX_TOKENS,
            "stream": true,
            // Usage у Chat Completions приходит только по запросу — отдельным
            // чанком после `finish_reason`; без него индикатор контекста пуст.
            "stream_options": {"include_usage": true}
        }))
    }

    fn anthropic_count_content(message: &ChatMessage) -> Value {
        if message.images.is_empty() {
            return json!(message.text);
        }
        let mut blocks = Vec::with_capacity(message.images.len() + 1);
        for image in &message.images {
            blocks.push(json!({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": image.media_type,
                    "data": image.data
                }
            }));
        }
        if !message.text.is_empty() {
            blocks.push(json!({"type": "text", "text": message.text}));
        }
        Value::Array(blocks)
    }

    fn count_body(&self, request: &LlmRequest) -> Value {
        let messages: Vec<Value> = request
            .messages
            .iter()
            .filter(|m| !m.text.is_empty() || !m.images.is_empty())
            .map(|m| json!({"role": m.role, "content": Self::anthropic_count_content(m)}))
            .collect();
        let mut body = json!({
            "model": self.selected_model(&request.model, request.options.thinking),
            "messages": messages
        });
        if !request.system.trim().is_empty() {
            body["system"] = json!(request.system);
        }
        body
    }

    fn cached_verdict(&self, model: &str) -> Option<bool> {
        self.verdicts
            .lock_unpoisoned()
            .get(model)
            .filter(|v| v.fresh())
            .map(|v| v.served)
    }

    fn remember_verdict(&self, model: &str, served: bool) {
        self.verdicts
            .lock_unpoisoned()
            .insert(model.to_string(), Verdict { served, at: Instant::now() });
    }

    /// **Каталог Xclis не сходится с реальностью, и это проверено живьём:** из
    /// четырнадцати объявленных группе моделей четыре отвечали 404 «not
    /// supported by any configured account in this group», включая единственную
    /// суффиксную `-thinking`. Показывать их в пикере значит предлагать выбор,
    /// который заведомо упадёт на отправке.
    ///
    /// Проверка бесплатная: шлюз сверяет модель с аккаунтом РАНЬШЕ, чем
    /// валидирует тело запроса, поэтому пустой `messages: []` у живой модели
    /// даёт 400 «all messages have empty content», а у чужой — тот самый 404.
    /// Ни одного сгенерированного токена. Пробы идут параллельно и только по
    /// моделям без свежего вердикта.
    async fn served_ids(&self, advertised: Vec<String>) -> Vec<String> {
        let pending: Vec<String> = advertised
            .iter()
            .filter(|id| self.cached_verdict(id).is_none())
            .cloned()
            .collect();
        let probed =
            futures_util::future::join_all(pending.iter().map(|id| self.model_is_served(id)))
                .await;
        for (id, served) in pending.iter().zip(probed) {
            self.remember_verdict(id, served);
        }
        advertised
            .into_iter()
            .filter(|id| self.cached_verdict(id).unwrap_or(true))
            .collect()
    }

    /// Обслуживает ли группа эту модель. **Сетевой сбой считается «да»**: иначе
    /// один таймаут вычистил бы пикер целиком, а это хуже лишней строки в нём.
    async fn model_is_served(&self, model: &str) -> bool {
        let body = json!({"model": model, "messages": []});
        match self
            .chat
            .post_response(CHAT_COMPLETIONS_PATH, &body, &CancellationToken::new(), None)
            .await
        {
            Ok(_) => true,
            Err(LlmError::Api(message)) => !Self::is_model_rejection(&message),
            Err(_) => true,
        }
    }

    /// Отказ обслужить модель. Вендор отвечает на это то `model_not_found`, то
    /// `server_error` — оба раза с 404 и одним и тем же текстом, поэтому
    /// опознаём по тексту, а не по типу ошибки.
    fn is_model_rejection(message: &str) -> bool {
        message.contains(MODEL_REJECTED_MARKER)
    }

    /// Отказ, пришедший в бою: вердикт запоминается, а общий каталог правится
    /// так, чтобы пикер перестал предлагать то, что вендор не сделает. Отказ
    /// по суффиксной модели — это «двойника нет»: базовая модель остаётся, но
    /// теряет способность рассуждать; отказ по базовой снимает её целиком.
    fn remember_rejected(&self, model: &str) {
        self.remember_verdict(model, false);
        let mut catalog = self.catalog.lock_unpoisoned();
        match model.strip_suffix(THINKING_SUFFIX) {
            Some(base) => {
                let app_id = Self::app_id(base);
                for entry in catalog.iter_mut().filter(|m| m.id == app_id) {
                    entry.adaptive = false;
                }
            }
            None => {
                let app_id = Self::app_id(model);
                catalog.retain(|m| m.id != app_id);
            }
        }
    }

    /// Ошибка запроса с побочным эффектом: отказ по модели запоминается, чтобы
    /// пикер перестал её предлагать.
    fn note_model_rejection<T>(&self, model: &str, result: Result<T, LlmError>) -> Result<T, LlmError> {
        if let Err(LlmError::Api(message)) = &result {
            if Self::is_model_rejection(message) {
                self.remember_rejected(model);
            }
        }
        result
    }

    fn completion_text(value: &Value) -> String {
        let content = &value["choices"][0]["message"]["content"];
        if let Some(text) = content_text(content).filter(|t| !t.trim().is_empty()) {
            return text.trim().to_string();
        }
        value["choices"][0]["message"]["reasoning_content"]
            .as_str()
            .unwrap_or_default()
            .trim()
            .to_string()
    }

    fn response_is_sse(resp: &reqwest::Response) -> bool {
        resp.headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.to_ascii_lowercase().contains(EVENT_STREAM_MIME))
    }

    /// Шлюз иногда отвечает на `stream: true` обычным JSON. Тело читается
    /// под тем же `cancel`, что и стрим: «Стоп» на нестриминговом ответе
    /// раньше ждал всё тело и отдавал дельту в уже закрытый чат.
    async fn consume_json_response(
        resp: reqwest::Response,
        cancel: &CancellationToken,
        sink: &mut dyn LlmStreamSink,
    ) -> Result<(), LlmError> {
        let value: Value = tokio::select! {
            v = resp.json::<Value>() => v.map_err(network_error)?,
            _ = cancel.cancelled() => return Err(LlmError::Cancelled),
        };
        if let Some(tokens) = prompt_tokens(&value) {
            sink.input_tokens(tokens);
        }
        let text = Self::completion_text(&value);
        if text.is_empty() {
            return Err(LlmError::Api(format!(
                "Xclis вернул 200, но без choices[0].message.content: {}",
                snippet(&value.to_string())
            )));
        }
        sink.text_delta(&text);
        Ok(())
    }

    fn model_version_key(id: &str) -> Vec<u32> {
        id.trim_end_matches(THINKING_SUFFIX)
            .split('-')
            .filter_map(|part| part.parse::<u32>().ok())
            .collect()
    }

    fn advertised_ids(value: &Value) -> Vec<String> {
        value["data"]
            .as_array()
            .map(|raw| raw.iter().filter_map(|v| v["id"].as_str().map(str::to_string)).collect())
            .unwrap_or_default()
    }

    /// Модели строятся ТОЛЬКО из обслуживаемых id — и это же множество решает,
    /// умеет ли модель размышлять. Считать `adaptive` по объявленному списку
    /// нельзя: у Xclis единственная суффиксная модель группы была объявлена и
    /// при этом мертва, то есть переключатель размышления обещал бы то, чего
    /// вендор не сделает, и отправка падала бы с 404.
    fn models_from(value: &Value, served: &[String]) -> Vec<ModelInfo> {
        let raw = value["data"].as_array().cloned().unwrap_or_default();
        let is_served = |id: &str| served.iter().any(|s| s == id);
        let mut models: Vec<ModelInfo> = raw
            .iter()
            .filter_map(|v| {
                let upstream_id = v["id"].as_str()?;
                if upstream_id.ends_with(THINKING_SUFFIX) || !is_served(upstream_id) {
                    return None;
                }
                let adaptive = is_served(&format!("{upstream_id}{THINKING_SUFFIX}"));
                Some(ModelInfo {
                    id: Self::app_id(upstream_id),
                    display_name: v["display_name"].as_str().unwrap_or(upstream_id).to_string(),
                    provider: PROVIDER_XCLIS.into(),
                    adaptive,
                    always_thinks: false,
                    code_exec: false,
                    max_input_tokens: 0,
                })
            })
            .collect();
        models.sort_by(|a, b| Self::model_version_key(&b.id).cmp(&Self::model_version_key(&a.id)));
        models
    }
}

#[async_trait::async_trait]
impl LlmProvider for XclisClient {
    fn provider_id(&self) -> &'static str {
        self.spec.id
    }

    fn known_models(&self) -> Vec<ModelInfo> {
        catalog_models(PROVIDER_XCLIS)
    }

    /// Неймспейс `xclis/…` — единственный офлайн-признак владельца: каталог
    /// агрегатора известен только из живого `/v1/models`.
    fn owns_model(&self, model_id: &str) -> bool {
        model_id.starts_with(MODEL_PREFIX)
    }

    async fn stream(
        &self,
        request: LlmRequest,
        cancel: CancellationToken,
        sink: &mut dyn LlmStreamSink,
    ) -> Result<(), LlmError> {
        let model = self.selected_model(&request.model, request.options.thinking);
        let body = self.chat_body(&request)?;
        let resp = self
            .chat
            .post_response(CHAT_COMPLETIONS_PATH, &body, &cancel, Some(EVENT_STREAM_MIME))
            .await;
        let resp = self.note_model_rejection(&model, resp)?;
        if Self::response_is_sse(&resp) {
            pump_sse_stream(resp, SseParser::with_block_parser(parse_block), &cancel, sink).await
        } else {
            Self::consume_json_response(resp, &cancel, sink).await
        }
    }

    async fn count_tokens(&self, request: LlmRequest) -> Result<u32, LlmError> {
        let model = self.selected_model(&request.model, request.options.thinking);
        let result = self.anthropic.post_json(COUNT_TOKENS_PATH, &self.count_body(&request)).await;
        let value = self.note_model_rejection(&model, result)?;
        value["input_tokens"]
            .as_u64()
            .map(|n| n as u32)
            .ok_or_else(|| LlmError::Api("Xclis count_tokens: ответ без input_tokens".into()))
    }

    /// Каталог только читается роутером и сливается им в общий; писать его
    /// отсюда нельзя — см. `ProviderRouter::catalog`.
    async fn list_models(&self) -> Result<Vec<ModelInfo>, LlmError> {
        let value = self.anthropic.get_json(MODELS_PATH, LIST_MODELS_TIMEOUT).await?;
        let served = self.served_ids(Self::advertised_ids(&value)).await;
        Ok(Self::models_from(&value, &served))
    }

    async fn reachable(&self) -> bool {
        self.anthropic.reachable(MODELS_PATH).await
    }

    async fn warm_up(&self) {
        self.anthropic.warm_up(MODELS_PATH).await;
    }
}

#[cfg(test)]
mod tests;
