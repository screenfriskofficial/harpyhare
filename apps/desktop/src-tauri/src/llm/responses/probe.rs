//! What a model of the Responses dialect can do — asked of the API, for free.
//!
//! `/v1/models` of this dialect names ids and nothing else: no display name, no
//! modality, no reasoning levels — 133 ids for one key, chat models mixed with
//! tts, embeddings, image and realtime ones. So each model is asked directly,
//! with a request built to be refused before anything is generated:
//! `reasoning.effort` set to a level few models take, plus a `temperature`,
//! which no reasoning model accepts. Validation stops the request whatever the
//! model is, and the refusal says what it is:
//!
//! - `model_not_found` (a 404, or a 400 on `model`) — not served by this
//!   endpoint (audio, image, embeddings…) or not open to this key;
//! - `unsupported_parameter` on `reasoning.effort` — chats, does not reason;
//! - `unsupported_value` on `reasoning.effort` — reasons, and the message lists
//!   every level it takes;
//! - a refusal of `temperature` — the level was accepted and the decoy stopped
//!   the request: ask again with the next level.
//!
//! Measured live on 2026-10-20 over all 92 ids one key listed: every probe was
//! refused, none generated. The level list exists only in the message text, so
//! it is parsed — and a message that stops parsing is "unknown", which the
//! caller treats as "not offered", never as a guess.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::llm::http::LlmHttp;
use crate::llm::Effort;
use crate::sync::LockUnpoisoned;

/// Asked in order. Most models refuse `minimal` and list their levels right
/// away; the GPT-5 line takes it, and refuses `max` instead.
const PROBE_LEVELS: [&str; 2] = ["minimal", "max"];
/// The decoy that keeps a probe free when the level is accepted.
const DECOY_TEMPERATURE: f64 = 0.5;
/// The API's floor — and so the most a probe could cost if one ever got through.
const PROBE_MAX_OUTPUT_TOKENS: u32 = 16;
const PROBE_INPUT: &str = ".";
const PROBE_TIMEOUT: Duration = Duration::from_secs(10);
/// Twelve in flight probe a whole account (≈90 ids) in a few seconds.
pub(super) const PROBE_CONCURRENCY: usize = 12;
/// What an id can do rarely changes, but whether this key may call it can.
const VERDICT_TTL: Duration = Duration::from_secs(7 * 24 * 60 * 60);

const SUPPORTED_VALUES_MARKER: &str = "Supported values are";
const ERROR_MODEL_NOT_FOUND: &str = "model_not_found";
const ERROR_UNSUPPORTED_PARAMETER: &str = "unsupported_parameter";
const ERROR_UNSUPPORTED_VALUE: &str = "unsupported_value";
const PARAM_REASONING_EFFORT: &str = "reasoning.effort";
const PARAM_TEMPERATURE: &str = "temperature";
const STATUS_NOT_FOUND: u16 = 404;

/// What the API said a model is.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Verdict {
    /// Not a chat model of this endpoint, or not open to this key.
    Unavailable,
    /// Chats, but refuses any `reasoning` field.
    Plain,
    /// Reasons; every `reasoning.effort` value it accepts, in the vendor's
    /// spelling (`none` and `minimal` included).
    Reasoning { levels: Vec<String> },
}

/// One probe's reading.
#[derive(Debug, PartialEq)]
pub(super) enum Reading {
    Settled(Verdict),
    /// The level went through; the next one will tell more.
    LevelAccepted,
    /// Rate limit, outage, a reworded message — nothing learnt, nothing kept.
    Unknown,
}

fn probe_body(model: &str, level: &str) -> Value {
    json!({
        "model": model,
        "input": PROBE_INPUT,
        "store": false,
        "max_output_tokens": PROBE_MAX_OUTPUT_TOKENS,
        "temperature": DECOY_TEMPERATURE,
        "reasoning": {"effort": level},
    })
}

/// The quoted values after «Supported values are» — the only place the API
/// states a model's levels.
pub(super) fn supported_values(message: &str) -> Option<Vec<String>> {
    let (_, tail) = message.split_once(SUPPORTED_VALUES_MARKER)?;
    let values: Vec<String> = tail
        .split('\'')
        .skip(1)
        .step_by(2)
        .map(str::to_string)
        .collect();
    (!values.is_empty()).then_some(values)
}

pub(super) fn read_refusal(status: u16, body: &Value) -> Reading {
    let error = &body["error"];
    let code = error["code"].as_str();
    let param = error["param"].as_str();
    if status == STATUS_NOT_FOUND || code == Some(ERROR_MODEL_NOT_FOUND) {
        return Reading::Settled(Verdict::Unavailable);
    }
    match (param, code) {
        (Some(PARAM_REASONING_EFFORT), Some(ERROR_UNSUPPORTED_PARAMETER)) => {
            Reading::Settled(Verdict::Plain)
        }
        (Some(PARAM_REASONING_EFFORT), Some(ERROR_UNSUPPORTED_VALUE)) => error["message"]
            .as_str()
            .and_then(supported_values)
            .map_or(Reading::Unknown, |levels| {
                Reading::Settled(Verdict::Reasoning { levels })
            }),
        (Some(PARAM_TEMPERATURE), _) => Reading::LevelAccepted,
        _ if (200..300).contains(&status) => Reading::LevelAccepted,
        _ => Reading::Unknown,
    }
}

/// Took both probe levels: it reasons across the whole ladder. Whether it can
/// stop reasoning is unknown, so the off value stays out of the list — the
/// toggle then locks instead of sending an "off" the model might refuse.
fn takes_every_probed_level() -> Verdict {
    let levels = std::iter::once(PROBE_LEVELS[0])
        .chain(Effort::ALL.iter().map(|e| e.as_str()))
        .map(str::to_string)
        .collect();
    Verdict::Reasoning { levels }
}

/// `None` — nothing could be learnt this time; ask again on the next listing.
pub(super) async fn probe(http: &LlmHttp, path: &str, model: &str) -> Option<Verdict> {
    for level in PROBE_LEVELS {
        let (status, body) = http
            .post_json_any_status(path, &probe_body(model, level), PROBE_TIMEOUT)
            .await
            .ok()?;
        match read_refusal(status, &body) {
            Reading::Settled(verdict) => return Some(verdict),
            Reading::LevelAccepted => continue,
            Reading::Unknown => return None,
        }
    }
    Some(takes_every_probed_level())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Record {
    verdict: Verdict,
    /// Unix seconds.
    checked_at: u64,
}

/// Verdicts outlive the process: probing an account is ~90 requests, and it is
/// paid once a week rather than on every launch. Keyed by vendor and model id,
/// because one dialect serves more than one vendor.
pub struct ModelProbes {
    path: Option<PathBuf>,
    records: Mutex<HashMap<String, Record>>,
}

pub type ProbeCache = Arc<ModelProbes>;

pub(super) fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

fn record_key(provider: &str, model: &str) -> String {
    format!("{provider}/{model}")
}

impl ModelProbes {
    pub fn in_memory() -> ProbeCache {
        Arc::new(Self {
            path: None,
            records: Mutex::default(),
        })
    }

    /// An unreadable or missing file is a cold start, not an error: the cache
    /// only saves requests, it never decides anything on its own.
    pub fn persisted(path: PathBuf) -> ProbeCache {
        let records = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Arc::new(Self {
            path: Some(path),
            records: Mutex::new(records),
        })
    }

    pub(super) fn fresh(&self, provider: &str, model: &str, now: u64) -> Option<Verdict> {
        self.records
            .lock_unpoisoned()
            .get(&record_key(provider, model))
            .filter(|r| now.saturating_sub(r.checked_at) < VERDICT_TTL.as_secs())
            .map(|r| r.verdict.clone())
    }

    pub(super) fn remember(&self, provider: &str, found: &[(String, Verdict)], now: u64) {
        if found.is_empty() {
            return;
        }
        let snapshot = {
            let mut records = self.records.lock_unpoisoned();
            for (model, verdict) in found {
                records.insert(
                    record_key(provider, model),
                    Record {
                        verdict: verdict.clone(),
                        checked_at: now,
                    },
                );
            }
            records.clone()
        };
        self.save(&snapshot);
    }

    fn save(&self, records: &HashMap<String, Record>) {
        let Some(path) = &self.path else { return };
        let written = serde_json::to_string(records)
            .map_err(std::io::Error::other)
            .and_then(|json| crate::settings::write_atomic_owner_only(path, &json));
        if let Err(e) = written {
            eprintln!("кэш проб моделей не сохранён ({e}) — следующий запуск спросит заново");
        }
    }
}

#[cfg(test)]
mod tests;
