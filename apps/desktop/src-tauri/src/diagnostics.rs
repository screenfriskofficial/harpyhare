//! Bounded process-local diagnostics. Payloads, credentials, URLs and audio
//! are deliberately excluded from this store.
use crate::error::ErrorCode;
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
    pub status: u16,
    pub request_id: Option<String>,
    pub retry_after_seconds: Option<u32>,
    pub elapsed_ms: u32,
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
    pub total_ms: u32,
    pub first_text_ms: Option<u32>,
    pub error_code: Option<ErrorCode>,
    pub requests: Vec<HttpObservation>,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticReport {
    pub schema_version: u32,
    pub app_version: String,
    pub platform: String,
    pub records: Vec<DiagnosticRecord>,
}

#[derive(Default)]
struct Store(VecDeque<DiagnosticRecord>);

impl Store {
    fn push(&mut self, record: DiagnosticRecord) {
        self.0.push_front(record);
        self.0.truncate(RECORD_LIMIT);
    }
}

fn store() -> &'static Mutex<Store> {
    static STORE: OnceLock<Mutex<Store>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(Store::default()))
}

fn millis(duration: Duration) -> u32 {
    duration.as_millis().min(u128::from(u32::MAX)) as u32
}

pub fn safe_identifier(value: &str) -> Option<String> {
    if value.chars().any(char::is_control) {
        return None;
    }
    let value = value.trim();
    if value.is_empty()
        || value.len() > IDENTIFIER_LIMIT
        || ["sk-", "gsk_", "itk_", "Bearer", "eyJ"]
            .iter()
            .any(|prefix| value.starts_with(prefix))
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
    inner: Arc<Mutex<DiagnosticRecord>>,
}

tokio::task_local! { static ACTIVE: Trace; }

impl Trace {
    pub fn new(
        kind: DiagnosticKind,
        origin: DiagnosticOrigin,
        provider: &str,
        model: &str,
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
            total_ms: 0,
            first_text_ms: None,
            error_code: None,
            requests: Vec::new(),
        };
        Self {
            started: Instant::now(),
            inner: Arc::new(Mutex::new(record)),
        }
    }

    pub async fn scope<F: std::future::Future>(&self, future: F) -> F::Output {
        ACTIVE.scope(self.clone(), future).await
    }

    pub fn first_text(&self, text: &str) {
        if text.trim().is_empty() {
            return;
        }
        let mut record = self.inner.lock().unwrap();
        if record.first_text_ms.is_none() {
            record.first_text_ms = Some(millis(self.started.elapsed()));
        }
    }

    pub fn finish(&self, error_code: Option<ErrorCode>) -> DiagnosticRecord {
        let mut record = self.inner.lock().unwrap().clone();
        record.total_ms = millis(self.started.elapsed());
        record.error_code = error_code;
        store().lock().unwrap().push(record.clone());
        record
    }
}

pub fn observe_response(status: u16, headers: &reqwest::header::HeaderMap) {
    let _ = ACTIVE.try_with(|trace| {
        let identifier = |name| {
            headers
                .get(name)
                .and_then(|v| v.to_str().ok())
                .and_then(safe_identifier)
        };
        let observation = HttpObservation {
            status,
            request_id: identifier("request-id")
                .or_else(|| identifier("x-request-id"))
                .or_else(|| identifier("dg-request-id")),
            retry_after_seconds: headers
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse().ok()),
            elapsed_ms: millis(trace.started.elapsed()),
        };
        let mut record = trace.inner.lock().unwrap();
        if record.requests.len() < REQUEST_LIMIT {
            record.requests.push(observation);
        }
    });
}

#[tauri::command]
#[specta::specta]
pub fn get_diagnostics() -> DiagnosticReport {
    DiagnosticReport {
        schema_version: 1,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        platform: std::env::consts::OS.to_string(),
        records: store().lock().unwrap().0.iter().cloned().collect(),
    }
}

#[tauri::command]
#[specta::specta]
pub fn clear_diagnostics() {
    store().lock().unwrap().0.clear();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifiers_reject_credentials() {
        for value in [
            "sk-secret",
            "Bearer token",
            "itk_token",
            "https://x.test?k=y",
            "\nsecret",
        ] {
            assert!(safe_identifier(value).is_none());
        }
        assert_eq!(safe_identifier("req-123").as_deref(), Some("req-123"));
    }

    #[test]
    fn records_are_bounded_and_metadata_only() {
        let trace = Trace::new(
            DiagnosticKind::Answer,
            DiagnosticOrigin::Session,
            "openai",
            "sk-secret",
        );
        let record = trace.finish(Some(ErrorCode::Api));
        let json = serde_json::to_string(&record).unwrap();
        assert!(!json.contains("sk-secret"));
        assert!(!json.contains("prompt"));
        let mut store = Store::default();
        for _ in 0..(RECORD_LIMIT + 1) {
            store.push(record.clone());
        }
        assert_eq!(store.0.len(), RECORD_LIMIT);
    }
}
