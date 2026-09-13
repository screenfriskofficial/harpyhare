//! OpenRouter Chat Completions client.
//!
//! OpenRouter model ids are prefixed inside the app (`openrouter/`) so a saved
//! model can never accidentally switch to a direct Anthropic or Xclis route.
//! The catalogue is narrowed to Claude Haiku and Sonnet, which are the models
//! this integration intentionally exposes.

use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

use super::http::{Credential, LlmHttp};
use super::registry::LlmProviderSpec;
use super::{
    ChatMessage, LlmError, LlmProvider, LlmRequest, LlmStreamSink, ModelInfo, SseOut, SseParser,
    LIST_MODELS_TIMEOUT, UNKNOWN_TOKEN_COUNT,
};

pub const PROVIDER_OPENROUTER: &str = "openrouter";
const MODEL_PREFIX: &str = "openrouter/";
const MODELS_PATH: &str = "/v1/models?output_modalities=text";
const CHAT_PATH: &str = "/v1/chat/completions";
const MAX_OUTPUT_TOKENS: u32 = 8192;
const STREAM_READ_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5 * 60);

/// Current public Claude entries are a fallback for a first launch without a
/// successful catalogue request. The live catalogue replaces these entries.
const FALLBACK_MODELS: &[(&str, &str, u32)] = &[
    (
        "anthropic/claude-haiku-4.5",
        "Anthropic: Claude Haiku 4.5",
        200000,
    ),
    (
        "anthropic/claude-sonnet-4.5",
        "Anthropic: Claude Sonnet 4.5",
        1000000,
    ),
    (
        "anthropic/claude-sonnet-5",
        "Anthropic: Claude Sonnet 5",
        1000000,
    ),
];

#[derive(Clone)]
struct CatalogEntry {
    info: ModelInfo,
    images: bool,
    max_output_tokens: Option<u32>,
    reasoning: Value,
}

fn positive_u32(value: &Value) -> Option<u32> {
    value
        .as_u64()
        .and_then(|n| u32::try_from(n).ok())
        .filter(|n| *n > 0)
}

fn has_string(value: &Value, needle: &str) -> bool {
    value
        .as_array()
        .is_some_and(|items| items.iter().any(|v| v.as_str() == Some(needle)))
}

fn is_supported_model(id: &str) -> bool {
    (id.starts_with("anthropic/claude-haiku-") || id.starts_with("anthropic/claude-sonnet-"))
        && !id.contains(':')
}

fn fallback_entry(id: &str, name: &str, context_length: u32) -> CatalogEntry {
    CatalogEntry {
        info: ModelInfo {
            id: format!("{MODEL_PREFIX}{id}"),
            display_name: name.into(),
            provider: PROVIDER_OPENROUTER.into(),
            adaptive: true,
            always_thinks: false,
            code_exec: false,
            max_input_tokens: context_length,
        },
        images: true,
        max_output_tokens: None,
        reasoning: json!({}),
    }
}

fn catalog_entry(value: &Value) -> Option<CatalogEntry> {
    let id = value["id"].as_str().filter(|id| is_supported_model(id))?;
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
    let mut value = json!({"exclude": true});
    if !entry.info.always_thinks {
        value["enabled"] = json!(requested);
    }
    if requested {
        let efforts = entry.reasoning["supported_efforts"].as_array();
        let default = entry.reasoning["default_effort"].as_str().filter(|effort| {
            *effort != "none"
                && efforts.is_none_or(|values| values.iter().any(|v| v.as_str() == Some(effort)))
        });
        if let Some(effort) = default.or_else(|| {
            efforts.and_then(|values| {
                values
                    .iter()
                    .filter_map(Value::as_str)
                    .find(|effort| *effort == "medium")
                    .or_else(|| {
                        values
                            .iter()
                            .filter_map(Value::as_str)
                            .find(|effort| *effort != "none")
                    })
            })
        }) {
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
        .filter(|id| is_supported_model(id))
        .ok_or_else(|| LlmError::Api("OpenRouter: invalid Claude model id".into()))?;
    if entry.is_some_and(|entry| !entry.images)
        && request.messages.iter().any(|m| !m.images.is_empty())
    {
        return Err(LlmError::Api(format!(
            "OpenRouter: {model} does not support images"
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

fn stream_error(error: &Value) -> SseOut {
    let message = format!(
        "OpenRouter: {}",
        error["message"].as_str().unwrap_or("request failed")
    );
    let code = error["code"]
        .as_u64()
        .and_then(|code| u16::try_from(code).ok())
        .or_else(|| match error["code"].as_str() {
            Some("rate_limit_error" | "rate_limit_exceeded") => Some(429),
            Some("server_error") => Some(500),
            _ => None,
        });
    if let Some(code) = code.filter(|code| *code == 429 || *code >= 500) {
        SseOut::Retryable(code, message)
    } else {
        SseOut::ApiError(message)
    }
}

fn parse_block(data: &str) -> Option<SseOut> {
    let payload = data
        .lines()
        .find_map(|line| line.strip_prefix("data:").map(str::trim_start))?;
    if payload == "[DONE]" {
        return Some(SseOut::Done(None));
    }
    let value = serde_json::from_str::<Value>(payload).ok()?;
    if !value["error"].is_null() {
        return Some(stream_error(&value["error"]));
    }
    if let Some(tokens) = positive_u32(&value["usage"]["prompt_tokens"]) {
        return Some(SseOut::InputTokens(tokens));
    }
    value["choices"][0]["delta"]["content"]
        .as_str()
        .filter(|text| !text.is_empty())
        .map(|text| SseOut::TextDelta(text.into()))
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
            .with_read_timeout(STREAM_READ_TIMEOUT),
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
        let catalogue = self.catalogue.lock().unwrap();
        if catalogue.is_empty() {
            FALLBACK_MODELS
                .iter()
                .map(|(id, name, context)| fallback_entry(id, name, *context).info)
                .collect()
        } else {
            catalogue.iter().map(|entry| entry.info.clone()).collect()
        }
    }

    fn owns_model(&self, model_id: &str) -> bool {
        model_id.starts_with(MODEL_PREFIX)
            && model_id
                .strip_prefix(MODEL_PREFIX)
                .is_some_and(is_supported_model)
    }

    async fn stream(
        &self,
        request: LlmRequest,
        cancel: CancellationToken,
        sink: &mut dyn LlmStreamSink,
    ) -> Result<(), LlmError> {
        if self.catalogue.lock().unwrap().is_empty() {
            let _ = tokio::select! {
                result = self.list_models() => result,
                _ = cancel.cancelled() => return Err(LlmError::Cancelled),
            };
        }
        let entry = self
            .catalogue
            .lock()
            .unwrap()
            .iter()
            .find(|entry| entry.info.id == request.model)
            .cloned();
        let body = request_body(&request, entry.as_ref())?;
        let mut answer_sink = AnswerSink {
            inner: sink,
            has_text: false,
        };
        self.http
            .post_sse(
                CHAT_PATH,
                &body,
                SseParser::with_block_parser(parse_block),
                cancel,
                &mut answer_sink,
            )
            .await?;
        if !answer_sink.has_text {
            return Err(LlmError::Api(
                "OpenRouter: model returned no answer text".into(),
            ));
        }
        Ok(())
    }

    async fn count_tokens(&self, _request: LlmRequest) -> Result<u32, LlmError> {
        Ok(UNKNOWN_TOKEN_COUNT)
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, LlmError> {
        let value = self.http.get_json(MODELS_PATH, LIST_MODELS_TIMEOUT).await?;
        let data = value["data"]
            .as_array()
            .ok_or_else(|| LlmError::Api("OpenRouter: invalid model catalogue".into()))?;
        let mut entries: Vec<_> = data.iter().filter_map(catalog_entry).collect();
        entries.sort_by(|a, b| a.info.id.cmp(&b.info.id));
        entries.dedup_by(|a, b| a.info.id == b.info.id);
        if entries.is_empty() {
            return Err(LlmError::Api(
                "OpenRouter: Claude Haiku/Sonnet not found".into(),
            ));
        }
        let models = entries.iter().map(|entry| entry.info.clone()).collect();
        *self.catalogue.lock().unwrap() = entries;
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
mod tests {
    use super::*;
    use wiremock::matchers::{body_string_contains, header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn request() -> LlmRequest {
        LlmRequest {
            model: "openrouter/anthropic/claude-haiku-4.5".into(),
            system: "Be concise".into(),
            messages: vec![ChatMessage {
                role: "user".into(),
                text: "Hello".into(),
                images: Vec::new(),
            }],
            options: super::super::RequestOptions {
                thinking: true,
                web_search: true,
            },
        }
    }

    #[test]
    fn only_claude_haiku_and_sonnet_models_are_owned() {
        assert!(is_supported_model("anthropic/claude-haiku-4.5"));
        assert!(is_supported_model("anthropic/claude-sonnet-5"));
        assert!(!is_supported_model("openai/gpt-5"));
        assert!(!is_supported_model("anthropic/claude-opus-4.6"));
        assert!(!is_supported_model("anthropic/claude-sonnet-5:beta"));
    }

    #[test]
    fn fallback_models_use_namespaced_ids() {
        let entry = fallback_entry(
            FALLBACK_MODELS[0].0,
            FALLBACK_MODELS[0].1,
            FALLBACK_MODELS[0].2,
        );
        assert!(entry.info.id.starts_with(MODEL_PREFIX));
        assert_eq!(entry.info.provider, PROVIDER_OPENROUTER);
    }

    #[test]
    fn chat_body_strips_internal_namespace_and_keeps_options() {
        let entry = fallback_entry(
            FALLBACK_MODELS[0].0,
            FALLBACK_MODELS[0].1,
            FALLBACK_MODELS[0].2,
        );
        let body = request_body(&request(), Some(&entry)).unwrap();
        assert_eq!(body["model"], "anthropic/claude-haiku-4.5");
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["messages"][1]["content"], "Hello");
        assert_eq!(body["stream"], true);
        assert_eq!(body["plugins"][0]["id"], "web");
    }

    #[test]
    fn chat_sse_parses_text_usage_done_and_retryable_errors() {
        assert_eq!(
            parse_block("data: {\"choices\":[{\"delta\":{\"content\":\"Hi\"}}]}"),
            Some(SseOut::TextDelta("Hi".into()))
        );
        assert_eq!(
            parse_block("data: {\"usage\":{\"prompt_tokens\":42}}"),
            Some(SseOut::InputTokens(42))
        );
        assert_eq!(parse_block("data: [DONE]"), Some(SseOut::Done(None)));
        assert!(matches!(
            parse_block("data: {\"error\":{\"code\":429,\"message\":\"busy\"}}"),
            Some(SseOut::Retryable(429, message)) if message.contains("busy")
        ));
    }

    #[test]
    fn unsupported_provider_models_never_claim_openrouter_ownership() {
        assert!(!is_supported_model("openrouter/anthropic/claude-haiku-4.5"));
        assert!(!is_supported_model("anthropic/claude-opus-4.6"));
        assert!(is_supported_model("anthropic/claude-haiku-4.5"));
    }

    fn live_model(id: &str) -> Value {
        json!({
            "id": id,
            "name": "Anthropic Claude test",
            "context_length": 200000,
            "architecture": {
                "input_modalities": ["text", "image"],
                "output_modalities": ["text"]
            },
            "top_provider": {"max_completion_tokens": 4096},
            "supported_parameters": ["reasoning"],
            "reasoning": {
                "mandatory": false,
                "supported_efforts": ["low", "medium"],
                "default_effort": "low"
            }
        })
    }

    #[tokio::test]
    async fn client_lists_models_and_streams_through_openrouter_wire_format() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "data": [live_model("anthropic/claude-haiku-4.5")]
            })))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .and(header("authorization", "Bearer test-key"))
            .and(body_string_contains("anthropic/claude-haiku-4.5"))
            .respond_with(ResponseTemplate::new(200).set_body_raw(
                "data: {\"choices\":[{\"delta\":{\"content\":\"OK\"}}]}\n\ndata: {\"usage\":{\"prompt_tokens\":7}}\n\ndata: [DONE]\n\n",
                "text/event-stream",
            ))
            .mount(&server)
            .await;

        let spec = super::super::registry::spec(PROVIDER_OPENROUTER).unwrap();
        let client = OpenRouterClient::new(spec, "test-key".into()).with_base_url(server.uri());
        let models = client.list_models().await.unwrap();
        assert_eq!(models.len(), 1);
        let mut sink = TestSink::default();
        client
            .stream(request(), CancellationToken::new(), &mut sink)
            .await
            .unwrap();
        assert_eq!(sink.text, "OK");
        assert_eq!(sink.tokens, 7);
    }

    #[derive(Default)]
    struct TestSink {
        text: String,
        tokens: u32,
    }

    impl LlmStreamSink for TestSink {
        fn text_delta(&mut self, delta: &str) {
            self.text.push_str(delta);
        }

        fn input_tokens(&mut self, total: u32) {
            self.tokens = total;
        }
    }
}
