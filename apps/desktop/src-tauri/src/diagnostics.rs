//! Bounded, process-local diagnostics. Only allowlisted metadata enters this
//! store: never request/response bodies, credentials, URLs or device names.
use crate::error::ErrorCode;
use crate::sync::LockUnpoisoned;
use serde::Serialize;
use std::collections::VecDeque;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex, OnceLock,
};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const RECORD_LIMIT: usize = 100;
const REQUEST_LIMIT: usize = 8;
const IDENTIFIER_LIMIT: usize = 160;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum DiagnosticKind {
    Capture,
    Transcription,
    Answer,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum DiagnosticOrigin {
    Session,
    Preflight,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HttpObservation {
    pub kind: HttpRequestKind,
    pub request_started_ms: Option<u32>,
    pub status: u16,
    pub request_id: Option<String>,
    pub edge_id: Option<String>,
    pub retry_after_seconds: Option<u32>,
    pub elapsed_ms: u32,
}

#[derive(Clone, Copy, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum HttpRequestKind {
    Catalog,
    Speech,
    Answer,
    SpeechStream,
    Other,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticRecord {
    pub id: String,
    #[specta(type = f64)]
    pub started_at: u64,
    pub kind: DiagnosticKind,
    pub origin: DiagnosticOrigin,
    pub provider: String,
    pub model: String,
    pub via_relay: bool,
    pub capture_ms: Option<u32>,
    pub processing_ms: Option<u32>,
    pub first_text_ms: Option<u32>,
    pub total_ms: u32,
    pub error_code: Option<ErrorCode>,
    pub requests: Vec<HttpObservation>,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticReport {
    pub schema_version: u32,
    pub app_version: String,
    pub platform: String,
    pub records: Vec<DiagnosticRecord>,
}

#[derive(Default)]
struct RecordStore(VecDeque<DiagnosticRecord>);

impl RecordStore {
    fn push(&mut self, record: DiagnosticRecord) {
        self.0.push_front(record);
        self.0.truncate(RECORD_LIMIT);
    }
}

fn store() -> &'static Mutex<RecordStore> {
    static STORE: OnceLock<Mutex<RecordStore>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(RecordStore::default()))
}

pub fn millis(duration: Duration) -> u32 {
    duration.as_millis().min(u128::from(u32::MAX)) as u32
}

pub fn safe_identifier(value: &str) -> Option<String> {
    if value.chars().any(char::is_control) {
        return None;
    }
    let value = value.trim();
    if value.is_empty()
        || value.len() > IDENTIFIER_LIMIT
        || ["sk-", "itk_", "Bearer", "eyJ"]
            .iter()
            .any(|p| value.starts_with(p))
        || !value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_.:/".contains(&c))
    {
        return None;
    }
    Some(value.to_string())
}

#[derive(Clone)]
pub struct Trace {
    started: Instant,
    inner: Arc<Mutex<(DiagnosticRecord, bool)>>,
}

tokio::task_local! { static ACTIVE: Trace; }

impl Trace {
    pub fn new(
        kind: DiagnosticKind,
        origin: DiagnosticOrigin,
        provider: &str,
        model: &str,
        via_relay: bool,
    ) -> Self {
        static SEQUENCE: AtomicU64 = AtomicU64::new(0);
        let started_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        let record = DiagnosticRecord {
            id: format!(
                "{started_at:x}-{:x}",
                SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ),
            started_at,
            kind,
            origin,
            provider: safe_identifier(provider).unwrap_or_default(),
            model: safe_identifier(model).unwrap_or_default(),
            via_relay,
            capture_ms: None,
            processing_ms: None,
            first_text_ms: None,
            total_ms: 0,
            error_code: None,
            requests: Vec::new(),
        };
        Self {
            started: Instant::now(),
            inner: Arc::new(Mutex::new((record, false))),
        }
    }

    pub async fn scope<T>(&self, future: impl std::future::Future<Output = T>) -> T {
        ACTIVE.scope(self.clone(), future).await
    }

    pub fn first_text(&self, text: &str) {
        if text.trim().is_empty() {
            return;
        }
        self.inner
            .lock_unpoisoned()
            .0
            .first_text_ms
            .get_or_insert(millis(self.started.elapsed()));
    }

    pub fn capture_duration(&self, duration: Duration) {
        self.inner.lock_unpoisoned().0.capture_ms = Some(millis(duration));
    }

    pub fn processing_duration(&self, duration: Duration) {
        self.inner.lock_unpoisoned().0.processing_ms = Some(millis(duration));
    }

    pub fn finish(&self, error_code: Option<ErrorCode>) -> DiagnosticRecord {
        let mut guard = self.inner.lock_unpoisoned();
        if !guard.1 {
            guard.0.total_ms = millis(self.started.elapsed());
            guard.0.error_code = error_code;
            guard.1 = true;
            store().lock_unpoisoned().push(guard.0.clone());
        }
        guard.0.clone()
    }
}

/// Task-local scope keeps concurrent chats isolated. Spawned STT transports
/// explicitly inherit their recording's trace; unrelated catalogue probes do not.
pub fn observe_response(status: u16, headers: &reqwest::header::HeaderMap) {
    observe_response_at(status, headers, None, HttpRequestKind::SpeechStream);
}

/// Dispatch offset and send-to-headers are separate measurements. The
/// latter includes upload, network and server processing, not pure upload time.
pub async fn send_request(
    request: impl std::future::Future<Output = Result<reqwest::Response, reqwest::Error>>,
) -> Result<reqwest::Response, reqwest::Error> {
    let dispatched = ACTIVE
        .try_with(|trace| millis(trace.started.elapsed()))
        .ok();
    let response = request.await?;
    // Audio-capable chat models (OpenRouter STT) use /chat/completions too.
    let transcribing = ACTIVE
        .try_with(|trace| trace.inner.lock_unpoisoned().0.kind == DiagnosticKind::Transcription)
        .unwrap_or(false);
    let path = response.url().path();
    let kind = if path.contains("/models") {
        HttpRequestKind::Catalog
    } else if transcribing || path.contains("/audio/") || path.ends_with("/listen") {
        HttpRequestKind::Speech
    } else if ["/responses", "/messages", "/completions"]
        .iter()
        .any(|p| path.ends_with(p))
    {
        HttpRequestKind::Answer
    } else {
        HttpRequestKind::Other
    };
    observe_response_at(
        response.status().as_u16(),
        response.headers(),
        dispatched,
        kind,
    );
    Ok(response)
}

fn observe_response_at(
    status: u16,
    headers: &reqwest::header::HeaderMap,
    request_started_ms: Option<u32>,
    kind: HttpRequestKind,
) {
    let _ = ACTIVE.try_with(|trace| {
        let identifier = |name| {
            headers
                .get(name)
                .and_then(|v| v.to_str().ok())
                .and_then(safe_identifier)
        };
        let observation = HttpObservation {
            kind,
            request_started_ms,
            status,
            request_id: identifier("request-id")
                .or_else(|| identifier("x-request-id"))
                .or_else(|| identifier("dg-request-id")),
            edge_id: identifier("cf-ray"),
            retry_after_seconds: headers
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse().ok()),
            elapsed_ms: millis(trace.started.elapsed()),
        };
        let mut guard = trace.inner.lock_unpoisoned();
        if !guard.1 && guard.0.requests.len() < REQUEST_LIMIT {
            guard.0.requests.push(observation);
        }
    });
}

pub fn answer_trace(app: &tauri::AppHandle, model: &str, origin: DiagnosticOrigin) -> Trace {
    use tauri::Manager;
    let state = app.state::<crate::app_state::App>();
    let provider = state
        .models
        .lock_unpoisoned()
        .iter()
        .find(|m| m.id == model)
        .map(|m| m.provider.clone())
        .or_else(|| {
            crate::llm::registry::PROVIDERS
                .iter()
                .find(|p| model.starts_with(&format!("{}/", p.id)))
                .map(|p| p.id.to_string())
        })
        .unwrap_or_default();
    let settings = crate::app_state::current_settings(app);
    let via_relay = !settings.access_token.is_empty()
        && crate::llm::registry::spec(&provider).is_some_and(|p| p.proxied);
    Trace::new(DiagnosticKind::Answer, origin, &provider, model, via_relay)
}

pub fn transcription_trace(
    settings: &crate::settings::Settings,
    origin: DiagnosticOrigin,
) -> Trace {
    let plan = crate::app_state::stt_client_plan(settings);
    let model = if plan.provider_id == "openrouter" {
        settings.openrouter_stt_model.as_str()
    } else {
        ""
    };
    Trace::new(
        DiagnosticKind::Transcription,
        origin,
        plan.provider_id,
        model,
        plan.proxy_base_url.is_some(),
    )
}

#[tauri::command]
#[specta::specta]
pub fn get_diagnostics() -> DiagnosticReport {
    DiagnosticReport {
        schema_version: 1,
        app_version: env!("CARGO_PKG_VERSION").into(),
        platform: std::env::consts::OS.into(),
        records: store().lock_unpoisoned().0.iter().cloned().collect(),
    }
}

#[tauri::command]
#[specta::specta]
pub fn clear_diagnostics() {
    store().lock_unpoisoned().0.clear();
}

#[cfg(test)]
mod tests;
