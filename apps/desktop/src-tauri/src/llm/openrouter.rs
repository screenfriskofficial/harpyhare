//! OpenRouter Chat Completions. App ids are `openrouter/<upstream-id>` so a
//! saved model cannot collide with a direct vendor or change billing routes.
//! Catalogue: https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties
//! Reasoning: https://openrouter.ai/docs/guides/best-practices/reasoning-tokens

use std::sync::{Arc, Mutex};

use crate::sync::LockUnpoisoned;
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

use super::http::{Credential, LlmHttp};
use super::registry::LlmProviderSpec;
use super::{
    ChatMessage, LlmError, LlmProvider, LlmRequest, LlmStreamSink, ModelInfo, SseOut, SseParser,
    LIST_MODELS_TIMEOUT, STREAM_IDLE_TIMEOUT, UNKNOWN_TOKEN_COUNT,
};

pub const PROVIDER_OPENROUTER: &str = "openrouter";
const MODEL_PREFIX: &str = "openrouter/";
const MODELS_PATH: &str = "/v1/models?output_modalities=text";
const CHAT_PATH: &str = "/v1/chat/completions";
const MAX_OUTPUT_TOKENS: u32 = 8192;

#[derive(Clone)]
struct CatalogEntry {
    info: ModelInfo,
    images: bool,
    max_output_tokens: Option<u32>,
    reasoning: Value,
}

fn has_string(value: &Value, needle: &str) -> bool {
    value
        .as_array()
        .is_some_and(|items| items.iter().any(|v| v.as_str() == Some(needle)))
}

fn positive_u32(value: &Value) -> Option<u32> {
    value
        .as_u64()
        .and_then(|n| u32::try_from(n).ok())
        .filter(|n| *n > 0)
}

fn catalog_entry(value: &Value) -> Option<CatalogEntry> {
    let id = value["id"].as_str().filter(|id| !id.trim().is_empty())?;
    let architecture = &value["architecture"];
    if !has_string(&architecture["input_modalities"], "text")
        || !has_string(&architecture["output_modalities"], "text")
    {
        return None;
    }
    let reasoning = value["reasoning"].clone();
    let always_thinks = reasoning["mandatory"].as_bool().unwrap_or(false);
    let supports_reasoning = reasoning.is_object()
        || has_string(&value["supported_parameters"], "reasoning")
        || has_string(&value["supported_parameters"], "reasoning_effort");
    Some(CatalogEntry {
        info: ModelInfo {
            id: format!("{MODEL_PREFIX}{id}"),
            display_name: value["name"]
                .as_str()
                .filter(|s| !s.is_empty())
                .unwrap_or(id)
                .into(),
            provider: PROVIDER_OPENROUTER.into(),
            adaptive: supports_reasoning && !always_thinks,
            always_thinks,
            code_exec: false,
            max_input_tokens: positive_u32(&value["context_length"]).unwrap_or(0),
        },
        images: has_string(&architecture["input_modalities"], "image"),
        max_output_tokens: positive_u32(&value["top_provider"]["max_completion_tokens"]),
        reasoning,
    })
}

fn reasoning_value(entry: &CatalogEntry, requested: bool) -> Option<Value> {
    if !entry.info.adaptive && !entry.info.always_thinks {
        return None;
    }
    // The app displays the answer only. Mandatory reasoning must never receive
    // an off switch, even if the chat was previously using a non-reasoning model.
    let mut value = json!({"exclude": true});
    if !entry.info.always_thinks {
        value["enabled"] = json!(requested);
    }
    if requested {
        let efforts = entry.reasoning["supported_efforts"].as_array();
        let default = entry.reasoning["default_effort"]
            .as_str()
            .filter(|s| *s != "none")
            .filter(|s| efforts.is_none_or(|values| values.iter().any(|v| v.as_str() == Some(s))));
        let effort = default.or_else(|| {
            efforts.and_then(|values| {
                values
                    .iter()
                    .filter_map(Value::as_str)
                    .find(|s| *s == "medium")
                    .or_else(|| {
                        values
                            .iter()
                            .filter_map(Value::as_str)
                            .find(|s| *s != "none")
                    })
            })
        });
        if let Some(effort) = effort {
            value["effort"] = json!(effort);
        }
    }
    Some(value)
}

fn message_value(message: &ChatMessage) -> Value {
    let content = if message.images.is_empty() {
        json!(message.text)
    } else {
        let mut blocks = Vec::new();
        if !message.text.is_empty() {
            blocks.push(json!({"type": "text", "text": message.text}));
        }
        blocks.extend(message.images.iter().map(|image| {
            json!({
                "type": "image_url",
                "image_url": {"url": format!("data:{};base64,{}", image.media_type, image.data)}
            })
        }));
        json!(blocks)
    };
    json!({"role": message.role, "content": content})
}

fn request_body(request: &LlmRequest, entry: Option<&CatalogEntry>) -> Result<Value, LlmError> {
    let model = request
        .model
        .strip_prefix(MODEL_PREFIX)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| LlmError::Api("OpenRouter: invalid model id".into()))?;
    if entry.is_some_and(|m| !m.images) && request.messages.iter().any(|m| !m.images.is_empty()) {
        return Err(LlmError::Api(format!(
            "OpenRouter: {model} does not support images. Select a vision model."
        )));
    }
    let mut messages = Vec::new();
    if !request.system.is_empty() {
        messages.push(json!({"role": "system", "content": request.system}));
    }
    messages.extend(
        request
            .messages
            .iter()
            .filter(|m| !m.text.is_empty() || !m.images.is_empty())
            .map(message_value),
    );
    let mut body = json!({
        "model": model,
        "messages": messages,
        "modalities": ["text"],
        "stream": true,
        "stream_options": {"include_usage": true}
    });
    if let Some(entry) = entry {
        if let Some(limit) = entry.max_output_tokens {
            body["max_tokens"] = json!(limit.min(MAX_OUTPUT_TOKENS));
        }
        if let Some(reasoning) = reasoning_value(entry, request.options.thinking) {
            body["reasoning"] = reasoning;
        }
    }
    if request.options.web_search {
        body["plugins"] = json!([{"id": "web"}]);
    }
    Ok(body)
}

fn error_event(error: &Value) -> SseOut {
    let message = format!(
        "OpenRouter: {}",
        error["message"].as_str().unwrap_or("request failed")
    );
    let code = error["code"]
        .as_u64()
        .and_then(|n| u16::try_from(n).ok())
        .or_else(|| match error["code"].as_str() {
            Some("rate_limit_exceeded" | "rate_limit_error") => Some(429),
            Some("server_error") => Some(500),
            _ => None,
        });
    match code {
        Some(code) if code == 429 || code >= 500 => SseOut::Retryable { code, message },
        _ => SseOut::ApiError(message),
    }
}

fn parse_block(data: &str) -> Vec<SseOut> {
    if data.trim() == "[DONE]" {
        return vec![SseOut::Done(None)];
    }
    let Ok(value) = serde_json::from_str::<Value>(data) else {
        return vec![SseOut::ApiError(
            "OpenRouter: invalid streaming response".into(),
        )];
    };
    if !value["error"].is_null() {
        return vec![error_event(&value["error"])];
    }
    let mut out = Vec::new();
    if let Some(tokens) = positive_u32(&value["usage"]["prompt_tokens"]) {
        out.push(SseOut::InputTokens(tokens));
    }
    let choice = &value["choices"][0];
    // Reasoning tokens are deliberately not treated as answer text.
    if let Some(text) = choice["delta"]["content"]
        .as_str()
        .filter(|s| !s.is_empty())
    {
        out.push(SseOut::TextDelta(text.into()));
    }
    match choice["finish_reason"].as_str() {
        Some("stop") => out.push(SseOut::Finished), // usage may arrive in the next chunk
        Some("length") => out.push(SseOut::ApiError(
            "OpenRouter: response reached the token limit".into(),
        )),
        Some("content_filter") => out.push(SseOut::ApiError(
            "OpenRouter: response blocked by the model's content filter".into(),
        )),
        Some(reason) => out.push(SseOut::ApiError(format!(
            "OpenRouter: unexpected finish reason ({reason})"
        ))),
        None => {}
    }
    out
}

struct AnswerSink<'a> {
    inner: &'a mut dyn LlmStreamSink,
    has_text: bool,
}

impl LlmStreamSink for AnswerSink<'_> {
    fn text_delta(&mut self, delta: &str) {
        self.has_text |= !delta.trim().is_empty();
        self.inner.text_delta(delta);
    }
    fn input_tokens(&mut self, total: u32) {
        self.inner.input_tokens(total);
    }
}

#[derive(Clone)]
pub struct OpenRouterClient {
    http: LlmHttp,
    catalogue: Arc<Mutex<Vec<CatalogEntry>>>,
}

impl OpenRouterClient {
    pub fn new(spec: &'static LlmProviderSpec, api_key: String) -> Self {
        Self {
            http: LlmHttp::direct(
                spec.wire.base_url(),
                Credential::Bearer(api_key),
                spec.wire.key_label(),
            )
            .with_read_timeout(STREAM_IDLE_TIMEOUT),
            catalogue: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub fn with_base_url(mut self, url: String) -> Self {
        self.http = self.http.with_base_url(url);
        self
    }
}

#[async_trait::async_trait]
impl LlmProvider for OpenRouterClient {
    fn provider_id(&self) -> &'static str {
        PROVIDER_OPENROUTER
    }
    fn known_models(&self) -> Vec<ModelInfo> {
        Vec::new()
    }
    fn owns_model(&self, model_id: &str) -> bool {
        model_id.starts_with(MODEL_PREFIX)
    }

    async fn stream(
        &self,
        request: LlmRequest,
        cancel: CancellationToken,
        sink: &mut dyn LlmStreamSink,
    ) -> Result<(), LlmError> {
        // Rebuilding clients after a key change does not erase saved models.
        // A catalogue outage must not prevent calling a saved upstream id.
        let empty = self.catalogue.lock_unpoisoned().is_empty();
        if empty {
            tokio::select! {
                _ = self.list_models() => {},
                _ = cancel.cancelled() => return Err(LlmError::Cancelled),
            }
        }
        let entry = self
            .catalogue
            .lock_unpoisoned()
            .iter()
            .find(|m| m.info.id == request.model)
            .cloned();
        let body = request_body(&request, entry.as_ref())?;
        let mut sink = AnswerSink {
            inner: sink,
            has_text: false,
        };
        self.http
            .post_sse(
                CHAT_PATH,
                &body,
                SseParser::with_block_parser(parse_block),
                cancel,
                &mut sink,
            )
            .await?;
        if !sink.has_text {
            return Err(LlmError::Api(
                "OpenRouter: model returned no answer text".into(),
            ));
        }
        Ok(())
    }

    async fn count_tokens(&self, _request: LlmRequest) -> Result<u32, LlmError> {
        // No universal count endpoint. Actual prompt usage arrives with SSE;
        // never create a paid completion just to estimate context usage.
        Ok(UNKNOWN_TOKEN_COUNT)
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, LlmError> {
        // Omitting pagination parameters returns the complete public catalogue.
        let value = self.http.get_json(MODELS_PATH, LIST_MODELS_TIMEOUT).await?;
        let data = value["data"]
            .as_array()
            .ok_or_else(|| LlmError::Api("OpenRouter: invalid model catalogue".into()))?;
        let mut entries: Vec<_> = data.iter().filter_map(catalog_entry).collect();
        entries.sort_by(|a, b| a.info.id.cmp(&b.info.id));
        entries.dedup_by(|a, b| a.info.id == b.info.id);
        if entries.is_empty() {
            return Err(LlmError::Api(
                "OpenRouter: no text models in catalogue".into(),
            ));
        }
        let models = entries.iter().map(|m| m.info.clone()).collect();
        *self.catalogue.lock_unpoisoned() = entries;
        Ok(models)
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
