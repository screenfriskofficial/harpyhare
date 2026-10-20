//! The OpenAI Responses API — a dialect, not a vendor.
//!
//! Spoken verbatim by more than OpenAI (same paths, same SSE event names), so a
//! vendor that speaks it needs a row in `registry` and nothing else. What
//! differs between such vendors is data, and lives on `LlmWire::Responses`.

use futures_util::StreamExt;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;

use super::http::{Credential, LlmHttp};
use super::registry::{LlmProviderSpec, LlmWire};
use super::{
    applicable_effort, sse_data_json, ChatMessage, Effort, ImageAttachment, LlmError, LlmProvider,
    LlmRequest, LlmStreamSink, ModelCatalog, ModelInfo, SseOut, SseParser, LIST_MODELS_TIMEOUT,
    MODELS_PATH, UNKNOWN_API_ERROR,
};
use crate::sync::LockUnpoisoned;

/// What each listed model can do, asked of the API itself.
pub mod probe;

use probe::{ModelProbes, ProbeCache, Verdict};

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
        LlmWire::Responses {
            effort_off,
            effort_on,
            ..
        } => (effort_off, effort_on),
        LlmWire::Anthropic { .. } => unreachable!("клиент Responses собран из чужого диалекта"),
    }
}

/// `None` means "send no `reasoning` field at all" — what an always-reasoning
/// model gets unless the chat picked a level it accepts: `gpt-5.5-pro` refuses
/// the vendor's "off" value and its "on" default alike is not ours to assume.
/// A chosen level replaces `effort_on`; with thinking off it is not applied.
pub fn reasoning_value(
    spec: &LlmProviderSpec,
    info: Option<&ModelInfo>,
    requested: bool,
    effort: Option<Effort>,
) -> Option<Value> {
    // A model that does not reason refuses the field outright, "off" included.
    if info.is_some_and(|m| !m.adaptive && !m.always_thinks) {
        return None;
    }
    let always = info.is_some_and(|m| m.always_thinks);
    if let Some(chosen) = applicable_effort(info, requested || always, effort) {
        return Some(json!({"effort": chosen}));
    }
    if always {
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
        "image_url": img.data_url()
    })
}

fn text_block(role: &str, text: &str) -> Value {
    let block_type = if role == ROLE_ASSISTANT {
        CONTENT_OUTPUT_TEXT
    } else {
        CONTENT_INPUT_TEXT
    };
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
        .filter(|m| !m.is_empty())
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
        Some("response.output_text.delta") => v["delta"]
            .as_str()
            .map(|d| SseOut::TextDelta(d.to_string())),
        Some("response.completed") => Some(SseOut::Done),
        Some("response.failed") => Some(failure_out(&v)),
        Some("response.incomplete") => Some(SseOut::Incomplete(
            error_message(&v).unwrap_or(UNKNOWN_API_ERROR).to_string(),
        )),
        Some("error") => Some(SseOut::ApiError(
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
        Some((_, status)) => SseOut::Retryable {
            code: *status,
            message,
        },
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

/// `gpt-4o-2024-08-06` beside `gpt-4o` is the same model pinned to a date;
/// so is the older `gpt-4-0613` beside `gpt-4`.
fn snapshot_alias(id: &str) -> Option<&str> {
    fn without_digits(s: &str, len: usize) -> Option<&str> {
        let (head, tail) = s.rsplit_once('-')?;
        (tail.len() == len && tail.bytes().all(|b| b.is_ascii_digit())).then_some(head)
    }
    without_digits(id, 2)
        .and_then(|s| without_digits(s, 2))
        .and_then(|s| without_digits(s, 4))
        .or_else(|| without_digits(id, 4))
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct LiveModel {
    pub id: String,
    /// Unix seconds; the only ordering this dialect's `/v1/models` offers.
    pub created: i64,
}

/// Newest first, each model once: a dated snapshot is dropped when its alias
/// is listed too — the picker would otherwise show `GPT-5.4` four times.
pub(crate) fn newest_first_without_snapshots(mut live: Vec<LiveModel>) -> Vec<String> {
    let ids: HashSet<String> = live.iter().map(|m| m.id.clone()).collect();
    live.sort_by(|a, b| b.created.cmp(&a.created).then_with(|| a.id.cmp(&b.id)));
    live.into_iter()
        .filter(|m| snapshot_alias(&m.id).is_none_or(|alias| !ids.contains(alias)))
        .map(|m| m.id)
        .collect()
}

/// `gpt-6.1-sol` → «GPT-6.1 Sol», `o3-mini` → «o3 Mini». This dialect's
/// `/v1/models` carries no display name at all.
pub(crate) fn display_name_from_id(id: &str) -> String {
    fn capitalized(s: &str) -> String {
        let mut chars = s.chars();
        chars
            .next()
            .map_or_else(String::new, |c| c.to_uppercase().chain(chars).collect())
    }
    let mut parts = id.split('-');
    let head = parts.next().unwrap_or_default();
    let mut words: Vec<String> = Vec::new();
    if head == "gpt" {
        let mut rest = parts.clone();
        match rest.next() {
            Some(version) if version.starts_with(|c: char| c.is_ascii_digit()) => {
                words.push(format!("GPT-{version}"));
                parts = rest;
            }
            _ => words.push("GPT".to_string()),
        }
    } else if head.bytes().all(|b| b.is_ascii_alphabetic()) {
        words.push(capitalized(head));
    } else {
        words.push(head.to_string());
    }
    words.extend(parts.map(capitalized));
    words.join(" ")
}

/// Serves any vendor whose row declares `LlmWire::Responses`. Everything it
/// needs to tell them apart is on that row, so a new one is data only.
#[derive(Clone)]
pub struct ResponsesClient {
    spec: &'static LlmProviderSpec,
    http: LlmHttp,
    /// The router's merged catalogue — where probed models are found again
    /// when a chat sends to one of them.
    live: ModelCatalog,
    probes: ProbeCache,
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
            live: Arc::new(Mutex::new(Vec::new())),
            probes: ModelProbes::in_memory(),
        }
    }

    /// Shares the app's catalogue, so a model probed at listing time keeps its
    /// capabilities when a chat sends to it.
    pub fn with_catalog(mut self, catalog: ModelCatalog) -> Self {
        self.live = catalog;
        self
    }

    /// Shares the app's verdicts, persisted between launches.
    pub fn with_probes(mut self, probes: ProbeCache) -> Self {
        self.probes = probes;
        self
    }

    pub fn with_base_url(mut self, url: String) -> Self {
        self.http = self.http.with_base_url(url);
        self
    }

    fn catalog(&self) -> Vec<ModelInfo> {
        self.spec.models()
    }

    /// Live first: a probed model is not in the offline table at all.
    fn model_info(&self, id: &str) -> Option<ModelInfo> {
        self.live
            .lock_unpoisoned()
            .iter()
            .find(|m| m.id == id && m.provider == self.spec.id)
            .cloned()
            .or_else(|| self.catalog().into_iter().find(|m| m.id == id))
    }

    /// Every id the key may call — chat or not; `/v1/models` of this dialect
    /// does not say.
    async fn live_models(&self) -> Result<Vec<LiveModel>, LlmError> {
        let v = self.http.get_json(MODELS_PATH, LIST_MODELS_TIMEOUT).await?;
        Ok(v["data"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|m| {
                        Some(LiveModel {
                            id: m["id"].as_str()?.to_string(),
                            created: m["created"].as_i64().unwrap_or_default(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default())
    }

    /// Remembered verdicts, plus fresh probes for the ids without one.
    async fn verdicts(&self, ids: &[String]) -> HashMap<String, Verdict> {
        let now = probe::now_secs();
        let mut known = HashMap::new();
        let mut unknown = Vec::new();
        for id in ids {
            match self.probes.fresh(self.spec.id, id, now) {
                Some(verdict) => {
                    known.insert(id.clone(), verdict);
                }
                None => unknown.push(id.clone()),
            }
        }
        let found: Vec<(String, Verdict)> = futures_util::stream::iter(unknown)
            .map(|id| async move {
                let verdict = probe::probe(&self.http, RESPONSES_PATH, &id).await;
                verdict.map(|v| (id, v))
            })
            .buffer_unordered(probe::PROBE_CONCURRENCY)
            .filter_map(|found| async move { found })
            .collect()
            .await;
        self.probes.remember(self.spec.id, &found, now);
        known.extend(found);
        known
    }

    /// `None` drops the id: not a chat model of this endpoint, or nothing is
    /// known about it — no verdict and no offline row to stand in for one.
    fn listed_model(&self, id: &str, verdict: Option<&Verdict>) -> Option<ModelInfo> {
        let offline = self.catalog().into_iter().find(|m| m.id == id);
        let Some(verdict) = verdict else {
            return offline;
        };
        let (off, on) = efforts(self.spec);
        let (adaptive, always_thinks, efforts) = match verdict {
            Verdict::Unavailable => return None,
            Verdict::Plain => (false, false, Vec::new()),
            Verdict::Reasoning { levels } => {
                let takes = |value: &str| levels.iter().any(|l| l == value);
                let ladder = Effort::ALL.into_iter().filter(|e| takes(e.as_str()));
                (true, !takes(off), ladder.collect())
            }
        };
        // The dialect's «on» value where the model takes it — what a chat that
        // turns reasoning on without a level has always sent — else its weakest.
        let default_effort = efforts
            .iter()
            .copied()
            .find(|e| e.as_str() == on)
            .or_else(|| efforts.first().copied());
        Some(ModelInfo {
            id: id.to_string(),
            display_name: offline.map_or_else(|| display_name_from_id(id), |m| m.display_name),
            provider: self.spec.id.to_string(),
            adaptive,
            always_thinks,
            code_exec: true,
            efforts,
            budget_thinking: false,
            default_effort,
        })
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
        let info = self.model_info(&request.model);
        let body = build_request_body(
            &request.model,
            &request.system,
            &request.messages,
            reasoning_value(
                self.spec,
                info.as_ref(),
                request.options.thinking,
                request.options.effort,
            ),
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

    /// Every chat model this key can call, newest first, each with the
    /// capabilities the API itself reported (see `probe`).
    async fn list_models(&self) -> Result<Vec<ModelInfo>, LlmError> {
        let ids = newest_first_without_snapshots(self.live_models().await?);
        let verdicts = self.verdicts(&ids).await;
        Ok(ids
            .iter()
            .filter_map(|id| self.listed_model(id, verdicts.get(id)))
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
