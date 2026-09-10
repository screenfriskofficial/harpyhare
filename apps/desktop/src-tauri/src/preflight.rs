//! Explicit, cancellable checks using the production capture/STT/LLM clients.
//! Samples belong to this run, never to the HUD recorder or chat history.
use crate::app_state::{self, current_settings};
use crate::diagnostics::{self, DiagnosticKind, DiagnosticOrigin, Trace};
use crate::error::{AppError, CodedError, ErrorCode};
use crate::permissions::PermissionState;
use crate::sync::LockUnpoisoned;
use crate::{audio, capture, events, llm, permissions, settings, stt};
use serde::Serialize;
use std::collections::VecDeque;
use std::sync::{
    atomic::{AtomicU32, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use tokio_util::sync::CancellationToken;

const SAMPLE_DURATION: Duration = Duration::from_secs(6);
const LEVEL_INTERVAL: Duration = Duration::from_millis(100);
const PROBE_TIMEOUT: Duration = Duration::from_secs(30);
const PREVIEW_CHAR_LIMIT: usize = 240;
const CANCELLED_RUN_LIMIT: usize = 16;
const METER_FLOOR_DB: f32 = -60.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum CheckStep {
    SystemAudio,
    Microphone,
    Transcription,
    Answer,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum CheckStatus {
    Passed,
    Failed,
    Skipped,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum CheckPhase {
    Preparing,
    Recording,
    Transcribing,
    Answering,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    pub step: CheckStep,
    pub source: Option<CheckStep>,
    pub status: CheckStatus,
    pub duration_ms: u32,
    pub error_code: Option<ErrorCode>,
    pub diagnostic_id: Option<String>,
    /// Explicitly shown only in the check UI, excluded from diagnostics export.
    pub preview: Option<String>,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AudioLevel {
    pub source: CheckStep,
    pub percent: u32,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PreflightProgress {
    pub run_id: String,
    pub phase: CheckPhase,
    pub remaining_ms: u32,
    pub levels: Vec<AudioLevel>,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PreflightReport {
    pub run_id: String,
    pub checks: Vec<CheckResult>,
}

#[derive(Default)]
struct RunRegistry {
    active: Option<(String, CancellationToken)>,
    cancelled: VecDeque<String>,
}

impl RunRegistry {
    fn begin(&mut self, id: &str) -> Result<CancellationToken, ErrorCode> {
        if self.cancelled.iter().any(|s| s == id) {
            return Err(ErrorCode::Cancelled);
        }
        if self.active.is_some() {
            return Err(ErrorCode::Retryable);
        }
        let token = CancellationToken::new();
        self.active = Some((id.to_string(), token.clone()));
        Ok(token)
    }

    fn cancel(&mut self, id: &str) {
        if let Some((active, token)) = &self.active {
            if active == id {
                token.cancel();
            }
        }
        self.cancelled.push_front(id.to_string());
        self.cancelled.truncate(CANCELLED_RUN_LIMIT);
    }

    fn finish(&mut self, id: &str) {
        if self.active.as_ref().is_some_and(|(active, _)| active == id) {
            self.active.take();
        }
    }
}

#[derive(Default)]
pub struct PreflightState(Mutex<RunRegistry>);

struct RunGuard {
    app: AppHandle,
    id: String,
    cancel: CancellationToken,
}
impl Drop for RunGuard {
    fn drop(&mut self) {
        self.cancel.cancel();
        self.app
            .state::<PreflightState>()
            .0
            .lock_unpoisoned()
            .finish(&self.id);
    }
}

pub fn cancel_active(app: &AppHandle) {
    if let Some(state) = app.try_state::<PreflightState>() {
        if let Some((_, cancel)) = &state.0.lock_unpoisoned().active {
            cancel.cancel();
        }
    }
}

#[tauri::command]
#[specta::specta]
pub fn cancel_preflight(app: AppHandle, run_id: String) {
    if diagnostics::safe_identifier(&run_id).is_some() {
        app.state::<PreflightState>()
            .0
            .lock_unpoisoned()
            .cancel(&run_id);
    }
}

fn progress(app: &AppHandle, run_id: &str, phase: CheckPhase) {
    events::preflight_progress(
        app,
        PreflightProgress {
            run_id: run_id.into(),
            phase,
            remaining_ms: 0,
            levels: Vec::new(),
        },
    );
}

fn result(
    step: CheckStep,
    source: Option<CheckStep>,
    started: Instant,
    trace: &Trace,
    outcome: Result<String, ErrorCode>,
) -> CheckResult {
    let error_code = outcome.as_ref().err().copied();
    let record = trace.finish(error_code);
    CheckResult {
        step,
        source,
        status: if error_code.is_some() {
            CheckStatus::Failed
        } else {
            CheckStatus::Passed
        },
        duration_ms: diagnostics::millis(started.elapsed()),
        error_code,
        diagnostic_id: Some(record.id),
        preview: outcome
            .ok()
            .filter(|s| !s.is_empty())
            .map(|s| s.chars().take(PREVIEW_CHAR_LIMIT).collect()),
    }
}

fn skipped(step: CheckStep, source: Option<CheckStep>) -> CheckResult {
    CheckResult {
        step,
        source,
        status: CheckStatus::Skipped,
        duration_ms: 0,
        error_code: None,
        diagnostic_id: None,
        preview: None,
    }
}

fn level_percent(samples: &[f32]) -> u32 {
    if samples.is_empty() {
        return 0;
    }
    let energy: f32 = samples
        .iter()
        .filter(|s| s.is_finite())
        .map(|s| s * s)
        .sum();
    let rms = (energy / samples.len() as f32).sqrt();
    let db = 20.0 * rms.max(f32::MIN_POSITIVE).log10();
    (((db - METER_FLOOR_DB) / -METER_FLOOR_DB).clamp(0.0, 1.0) * 100.0).round() as u32
}

struct Sample {
    source: CheckStep,
    samples: Vec<f32>,
}
struct CaptureJob {
    source: CheckStep,
    capture: capture::AudioCapture,
    level: Arc<AtomicU32>,
    trace: Trace,
    started: Instant,
}

fn capture_samples(
    app: &AppHandle,
    run_id: &str,
    settings: &settings::Settings,
    permissions: &permissions::PermissionsStatus,
    cancel: &CancellationToken,
) -> (Vec<CheckResult>, Vec<Sample>) {
    let sources = [
        (
            CheckStep::SystemAudio,
            settings.capture_system_audio,
            permissions.audio,
            settings.capture_device_uid.as_str(),
        ),
        (
            CheckStep::Microphone,
            settings.capture_microphone,
            permissions.microphone,
            settings.microphone_device_uid.as_str(),
        ),
    ];
    let mut checks = Vec::new();
    let mut jobs = Vec::new();
    for (source, enabled, permission, uid) in sources {
        if !enabled {
            checks.push(skipped(source, None));
            continue;
        }
        if cancel.is_cancelled() {
            break;
        }
        let started = Instant::now();
        let trace = Trace::new(
            DiagnosticKind::Capture,
            DiagnosticOrigin::Preflight,
            "",
            "",
            false,
        );
        if permission != PermissionState::Granted {
            checks.push(result(
                source,
                None,
                started,
                &trace,
                Err(ErrorCode::Permission),
            ));
            continue;
        }
        let level = Arc::new(AtomicU32::new(0));
        let uid = (!uid.is_empty()).then_some(uid);
        let opened = if source == CheckStep::SystemAudio {
            capture::AudioCapture::system(uid, 0)
        } else {
            capture::AudioCapture::microphone(uid)
        };
        match opened {
            Ok(capture) => jobs.push(CaptureJob {
                source,
                capture,
                level,
                trace,
                started,
            }),
            Err(error) => checks.push(result(source, None, started, &trace, Err(error.code()))),
        }
    }
    // Open both devices before recording either one: a slow second device must
    // not silently extend the first source beyond the advertised sample window.
    let mut recording = Vec::new();
    for mut job in jobs {
        if cancel.is_cancelled() {
            job.trace.finish(Some(ErrorCode::Cancelled));
            continue;
        }
        let meter = Arc::clone(&job.level);
        match job.capture.start(Some(Box::new(move |samples| {
            meter.store(level_percent(samples), Ordering::Relaxed);
        }))) {
            Ok(()) => recording.push(job),
            Err(error) => checks.push(result(
                job.source,
                None,
                job.started,
                &job.trace,
                Err(error.code()),
            )),
        }
    }
    let jobs = recording;
    let started = Instant::now();
    while !jobs.is_empty() && started.elapsed() < SAMPLE_DURATION && !cancel.is_cancelled() {
        events::preflight_progress(
            app,
            PreflightProgress {
                run_id: run_id.into(),
                phase: CheckPhase::Recording,
                remaining_ms: diagnostics::millis(
                    SAMPLE_DURATION.saturating_sub(started.elapsed()),
                ),
                levels: jobs
                    .iter()
                    .map(|j| AudioLevel {
                        source: j.source,
                        percent: j.level.load(Ordering::Relaxed),
                    })
                    .collect(),
            },
        );
        std::thread::sleep(LEVEL_INTERVAL);
    }
    // Stop every producer before draining either source. Hardware is released
    // on this blocking worker even when the UI disappears or cancels the run.
    for job in &jobs {
        job.capture.request_stop();
    }
    let mut samples = Vec::new();
    for job in jobs {
        let outcome = job.capture.finish().map_err(|e| e.code());
        if let Ok(pcm) = &outcome {
            job.trace.capture_duration(Duration::from_secs_f64(
                pcm.len() as f64 / f64::from(audio::TARGET_SAMPLE_RATE),
            ));
        }
        let verdict = if cancel.is_cancelled() {
            Err(ErrorCode::Cancelled)
        } else {
            outcome.and_then(|pcm| {
                if audio::is_silence(&pcm) {
                    return Err(ErrorCode::Silence);
                }
                samples.push(Sample {
                    source: job.source,
                    samples: pcm,
                });
                Ok(String::new())
            })
        };
        checks.push(result(job.source, None, job.started, &job.trace, verdict));
    }
    (checks, samples)
}

async fn check_speech(
    engine: Arc<dyn stt::SttEngine>,
    sample: Sample,
    settings: &settings::Settings,
    cancel: &CancellationToken,
) -> CheckResult {
    let trace = diagnostics::transcription_trace(settings, DiagnosticOrigin::Preflight);
    let started = Instant::now();
    let outcome = tokio::select! {
        biased;
        () = cancel.cancelled() => Err(ErrorCode::Cancelled),
        res = tokio::time::timeout(PROBE_TIMEOUT, trace.scope(engine.transcribe(&sample.samples, &[]))) => match res {
            Ok(Ok(text)) if !text.trim().is_empty() => Ok(text),
            Ok(Ok(_)) => Err(ErrorCode::Silence),
            Ok(Err(error)) => Err(error.code()),
            Err(_) => Err(ErrorCode::Timeout),
        },
    };
    trace.processing_duration(started.elapsed());
    result(
        CheckStep::Transcription,
        Some(sample.source),
        started,
        &trace,
        outcome,
    )
}

struct ProbeSink {
    trace: Trace,
    text: String,
    cancel: CancellationToken,
}
impl llm::LlmStreamSink for ProbeSink {
    fn text_delta(&mut self, delta: &str) {
        self.trace.first_text(delta);
        self.text.extend(
            delta
                .chars()
                .take(PREVIEW_CHAR_LIMIT.saturating_sub(self.text.chars().count())),
        );
        // A provider ignoring the tiny test prompt must not generate an essay.
        if self.text.chars().count() >= PREVIEW_CHAR_LIMIT {
            self.cancel.cancel();
        }
    }
    fn input_tokens(&mut self, _total: u32) {}
}

async fn check_answer(
    provider: Arc<dyn llm::LlmProvider>,
    model: String,
    trace: Trace,
    cancel: &CancellationToken,
) -> CheckResult {
    let started = Instant::now();
    let transport_cancel = cancel.child_token();
    let mut sink = ProbeSink {
        trace: trace.clone(),
        text: String::new(),
        cancel: transport_cancel.clone(),
    };
    let request = llm::LlmRequest {
        model,
        system: "This is a connection test. Reply with the single word OK.".into(),
        messages: vec![llm::ChatMessage {
            role: "user".into(),
            text: "Reply OK.".into(),
            images: Vec::new(),
        }],
        options: llm::RequestOptions::default(),
    };
    let outcome = tokio::select! {
        biased;
        () = cancel.cancelled() => Err(ErrorCode::Cancelled),
        res = tokio::time::timeout(PROBE_TIMEOUT, trace.scope(provider.stream(request, transport_cancel.clone(), &mut sink))) => match res {
            Ok(Ok(())) => Ok(()),
            Ok(Err(llm::LlmError::Cancelled)) if !sink.text.trim().is_empty() && !cancel.is_cancelled() => Ok(()),
            Ok(Err(error)) => Err(error.code()),
            Err(_) => Err(ErrorCode::Timeout),
        },
    };
    transport_cancel.cancel();
    let outcome = outcome.and_then(|()| {
        if sink.text.trim().is_empty() {
            Err(ErrorCode::Api)
        } else {
            Ok(sink.text)
        }
    });
    result(CheckStep::Answer, None, started, &trace, outcome)
}

#[tauri::command]
#[specta::specta]
pub async fn run_preflight(
    app: AppHandle,
    run_id: String,
    model: String,
) -> Result<PreflightReport, AppError> {
    if diagnostics::safe_identifier(&run_id).is_none()
        || diagnostics::safe_identifier(&model).is_none()
    {
        return Err(AppError::new(
            ErrorCode::Internal,
            "Invalid check parameters",
        ));
    }
    let cancel = app
        .state::<PreflightState>()
        .0
        .lock_unpoisoned()
        .begin(&run_id)
        .map_err(|code| AppError::new(code, "Check unavailable"))?;
    let _guard = RunGuard {
        app: app.clone(),
        id: run_id.clone(),
        cancel: cancel.clone(),
    };
    if app
        .state::<app_state::App>()
        .recording_enabled
        .load(Ordering::Acquire)
    {
        return Err(AppError::new(
            ErrorCode::Retryable,
            "Stop the interview before checking audio",
        ));
    }
    // Snapshot both settings and clients before yielding: a later edit cannot
    // make this run report success for a mixture of two configurations.
    let settings = current_settings(&app);
    let engine = app_state::stt_engine(&app);
    let provider = app_state::llm_provider(&app);
    progress(&app, &run_id, CheckPhase::Preparing);
    let permissions = permissions::permissions_status(app.clone()).await;
    let (mut checks, samples) = {
        let app = app.clone();
        let id = run_id.clone();
        let settings = settings.clone();
        let token = cancel.clone();
        tokio::task::spawn_blocking(move || {
            capture_samples(&app, &id, &settings, &permissions, &token)
        })
        .await
        .map_err(|_| AppError::new(ErrorCode::Internal, "Audio check interrupted"))?
    };
    if cancel.is_cancelled() {
        return Err(AppError::new(ErrorCode::Cancelled, "Check cancelled"));
    }
    progress(&app, &run_id, CheckPhase::Transcribing);
    if samples.is_empty() {
        checks.push(skipped(CheckStep::Transcription, None));
    }
    let results = futures_util::future::join_all(
        samples
            .into_iter()
            .map(|sample| check_speech(Arc::clone(&engine), sample, &settings, &cancel)),
    )
    .await;
    checks.extend(results);
    if cancel.is_cancelled() {
        return Err(AppError::new(ErrorCode::Cancelled, "Check cancelled"));
    }
    progress(&app, &run_id, CheckPhase::Answering);
    let answer_trace = diagnostics::answer_trace(&app, &model, DiagnosticOrigin::Preflight);
    checks.push(check_answer(provider, model, answer_trace, &cancel).await);
    if cancel.is_cancelled() {
        return Err(AppError::new(ErrorCode::Cancelled, "Check cancelled"));
    }
    Ok(PreflightReport { run_id, checks })
}

#[cfg(test)]
mod tests;
