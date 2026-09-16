//! OpenAI-compatible Chat Completions — a dialect, not a vendor.
//!
//! Xclis and OpenRouter both speak it, and what they share lives here: the
//! message shape (a leading `system` turn, text and `image_url` blocks), the
//! chunk parser (`[DONE]`, `choices[0].delta.content`, errors inside a 200
//! stream) and ONE finish-reason policy. A vendor module keeps only its own
//! data — model naming, catalogue, limits, proxy policy — and a one-line
//! `parse_block` that names the vendor in the messages.

use serde_json::{json, Value};

use super::{ChatMessage, LlmError, LlmRequest, SseOut, UNKNOWN_API_ERROR};

const DONE_SENTINEL: &str = "[DONE]";
const ERROR_BODY_CHARS: usize = 500;
const ROLE_SYSTEM: &str = "system";
const FINISH_STOP: &str = "stop";
const FINISH_ERROR: &str = "error";
/// Named error codes some gateways send inside a 200 stream instead of a
/// number, with the HTTP status `LlmError::Retryable` reports for them.
const RETRYABLE_ERROR_CODES: [(&str, u16); 3] = [
    ("rate_limit_exceeded", 429),
    ("rate_limit_error", 429),
    ("server_error", 500),
];

/// A bounded piece of a body for an error message.
pub(crate) fn snippet(text: &str) -> String {
    text.chars().take(ERROR_BODY_CHARS).collect()
}

/// The leading `system` turn, or none when there is nothing to say: an empty
/// system message is a wasted turn some gateways reject outright.
fn system_message(system: &str) -> Option<Value> {
    (!system.trim().is_empty()).then(|| json!({"role": ROLE_SYSTEM, "content": system}))
}

/// `content` is a plain string for a text-only turn and an array of blocks
/// once an image is attached: the text first, then `image_url` data URLs.
fn message_json(message: &ChatMessage) -> Value {
    let content = if message.images.is_empty() {
        json!(message.text)
    } else {
        let mut blocks = Vec::with_capacity(message.images.len() + 1);
        if !message.text.is_empty() {
            blocks.push(json!({"type": "text", "text": message.text}));
        }
        blocks.extend(
            message
                .images
                .iter()
                .map(|image| json!({"type": "image_url", "image_url": {"url": image.data_url()}})),
        );
        Value::Array(blocks)
    };
    json!({"role": message.role, "content": content})
}

/// The `messages` array: the system turn, then every non-empty history turn.
pub(crate) fn messages_json(request: &LlmRequest) -> Vec<Value> {
    system_message(&request.system)
        .into_iter()
        .chain(
            request
                .messages
                .iter()
                .filter(|m| !m.is_empty())
                .map(message_json),
        )
        .collect()
}

/// Text of a `content` field: a string for most vendors, an array of
/// `{text}`/`{content}` parts for some gateways. Reasoning parts are not the
/// answer and are never read here.
pub(crate) fn content_text(content: &Value) -> Option<String> {
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

/// What a `finish_reason` means for the answer, the same for every vendor of
/// the dialect: `stop` ends it (`Finished` — a usage chunk and `[DONE]` may
/// still follow, so the stream is read on); `error` is the vendor's failure;
/// anything else — `length`, `content_filter`, a `tool_calls` turn this client
/// cannot continue, a reason never seen before — stopped the answer early, and
/// the text streamed so far is not a finished result.
pub(crate) fn finish_out(choice: &Value, label: &str) -> Option<SseOut> {
    match choice["finish_reason"].as_str() {
        None => None,
        Some(FINISH_STOP) => Some(SseOut::Finished),
        Some(FINISH_ERROR) => Some(SseOut::ApiError(format!(
            "{label}: {UNKNOWN_API_ERROR} (finish_reason = {FINISH_ERROR})"
        ))),
        Some(reason) => Some(SseOut::Incomplete(format!("{label}: {reason}"))),
    }
}

/// The same verdict for a completion that arrived as plain JSON instead of a
/// stream (a gateway may ignore `stream: true`).
pub(crate) fn finish_error(choice: &Value, label: &str) -> Result<(), LlmError> {
    match finish_out(choice, label) {
        Some(SseOut::Incomplete(reason)) => Err(LlmError::Incomplete(reason)),
        Some(SseOut::ApiError(message)) => Err(LlmError::Api(message)),
        _ => Ok(()),
    }
}

/// An error object inside a 200 stream, classified like an HTTP failure:
/// numeric or named codes for overload and limits become `Retryable`, billing
/// and quota keep their own codes, the rest is the vendor's API error.
fn error_out(error: &Value, label: &str) -> SseOut {
    let message = format!(
        "{label}: {}",
        error["message"].as_str().unwrap_or(UNKNOWN_API_ERROR)
    );
    let code = error["code"]
        .as_u64()
        .and_then(|n| u16::try_from(n).ok())
        .or_else(|| {
            let name = error["code"].as_str()?;
            RETRYABLE_ERROR_CODES
                .iter()
                .find(|(known, _)| *known == name)
                .map(|(_, status)| *status)
        });
    match code {
        Some(code) if code == 429 || code >= 500 => SseOut::Retryable { code, message },
        _ => super::classified_stream_error(code.unwrap_or(200), error, message),
    }
}

/// One streamed chunk of the dialect; `label` names the vendor in messages.
pub(crate) fn parse_chunk(data: &str, label: &str) -> Vec<SseOut> {
    if data.trim() == DONE_SENTINEL {
        return vec![SseOut::Done];
    }
    let value = match serde_json::from_str::<Value>(data) {
        Ok(value) => value,
        Err(error) => {
            return vec![SseOut::ApiError(format!(
                "{label}: некорректный SSE JSON: {error}; {}",
                snippet(data)
            ))]
        }
    };
    if !value["error"].is_null() {
        return vec![error_out(&value["error"], label)];
    }
    let choice = &value["choices"][0];
    let mut out = Vec::new();
    if let Some(text) = content_text(&choice["delta"]["content"]).filter(|t| !t.is_empty()) {
        out.push(SseOut::TextDelta(text));
    }
    out.extend(finish_out(choice, label));
    out
}

#[cfg(test)]
mod tests;
