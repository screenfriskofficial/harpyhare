//! A bounded, cancellable smoke check for the configuration currently selected
//! by the user. It never writes to chat history and never sends captured audio.
use crate::app_state::{build_capture, build_microphone_capture, current_settings, llm_provider};
use crate::diagnostics::{self, DiagnosticKind, DiagnosticOrigin};
use crate::error::{CodedError, ErrorCode};
use serde::Serialize;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use std::time::Duration;
use tauri::AppHandle;

const CAPTURE_PROBE_DURATION: Duration = Duration::from_millis(250);
const NETWORK_PROBE_TIMEOUT: Duration = Duration::from_secs(15);

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

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    pub step: CheckStep,
    pub status: CheckStatus,
    pub duration_ms: u32,
    pub error_code: Option<ErrorCode>,
    pub detail: String,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PreflightReport {
    pub checks: Vec<CheckResult>,
}

fn capture_probe(
    step: CheckStep,
    capture: Option<crate::capture::SystemAudioCapture>,
) -> CheckResult {
    let started = std::time::Instant::now();
    let Some(mut capture) = capture else {
        return CheckResult {
            step,
            status: CheckStatus::Failed,
            duration_ms: 0,
            error_code: Some(ErrorCode::Permission),
            detail: "Захват недоступен — проверь устройство и разрешение".into(),
        };
    };
    let samples = Arc::new(AtomicUsize::new(0));
    let seen = Arc::clone(&samples);
    if let Err(error) = capture.start(Some(Box::new(move |chunk| {
        seen.fetch_add(chunk.len(), Ordering::Relaxed);
    }))) {
        return CheckResult {
            step,
            status: CheckStatus::Failed,
            duration_ms: elapsed_ms(started),
            error_code: Some(error.code()),
            detail: error.to_string(),
        };
    }
    std::thread::sleep(CAPTURE_PROBE_DURATION);
    let result = capture.stop();
    let sample_count = samples.load(Ordering::Relaxed);
    match result {
        Ok(_) if sample_count > 0 => CheckResult {
            step,
            status: CheckStatus::Passed,
            duration_ms: elapsed_ms(started),
            error_code: None,
            detail: format!("Получено сэмплов: {sample_count}"),
        },
        Ok(_) => CheckResult {
            step,
            status: CheckStatus::Passed,
            duration_ms: elapsed_ms(started),
            error_code: None,
            detail: "Поток захвата запущен; во время проверки сигнал не обнаружен".into(),
        },
        Err(error) => CheckResult {
            step,
            status: CheckStatus::Failed,
            duration_ms: elapsed_ms(started),
            error_code: Some(error.code()),
            detail: error.to_string(),
        },
    }
}

fn elapsed_ms(started: std::time::Instant) -> u32 {
    started.elapsed().as_millis().min(u128::from(u32::MAX)) as u32
}

fn configured_stt_result(settings: &crate::settings::Settings) -> CheckResult {
    let started = std::time::Instant::now();
    let spec = crate::stt::registry::resolve(&settings.stt_provider);
    let has_key = !crate::settings::api_key_for(settings, spec.key_id).is_empty()
        || (spec.proxied && !settings.access_token.is_empty());
    CheckResult {
        step: CheckStep::Transcription,
        status: if has_key {
            CheckStatus::Passed
        } else {
            CheckStatus::Failed
        },
        duration_ms: elapsed_ms(started),
        error_code: (!has_key).then_some(ErrorCode::BadApiKey),
        detail: if has_key {
            format!("Провайдер {} настроен", spec.label)
        } else {
            format!("Не найден ключ {}", spec.key_label)
        },
    }
}

async fn answer_result(app: &AppHandle, model: String) -> CheckResult {
    let started = std::time::Instant::now();
    let trace = diagnostics::Trace::new(
        DiagnosticKind::Answer,
        DiagnosticOrigin::Preflight,
        llm_provider(app).provider_id(),
        &model,
    );
    let result = tokio::time::timeout(
        NETWORK_PROBE_TIMEOUT,
        trace.scope(llm_provider(app).reachable()),
    )
    .await;
    let passed = matches!(result, Ok(true));
    let error_code = (!passed).then_some(ErrorCode::Network);
    trace.finish(error_code);
    CheckResult {
        step: CheckStep::Answer,
        status: if passed {
            CheckStatus::Passed
        } else {
            CheckStatus::Failed
        },
        duration_ms: elapsed_ms(started),
        error_code,
        detail: if passed {
            "LLM отвечает на проверку доступности".into()
        } else {
            "LLM недоступен".into()
        },
    }
}

#[tauri::command]
#[specta::specta]
pub async fn run_preflight(app: AppHandle, model: String) -> PreflightReport {
    let settings = current_settings(&app);
    let system = std::thread::spawn({
        let settings = settings.clone();
        move || capture_probe(CheckStep::SystemAudio, build_capture(&settings))
    });
    let microphone = std::thread::spawn({
        let settings = settings.clone();
        move || capture_probe(CheckStep::Microphone, build_microphone_capture(&settings))
    });
    let mut checks = vec![system.join().unwrap_or_else(|_| CheckResult {
        step: CheckStep::SystemAudio,
        status: CheckStatus::Failed,
        duration_ms: 0,
        error_code: Some(ErrorCode::Internal),
        detail: "Проверка прервана".into(),
    })];
    checks.push(microphone.join().unwrap_or_else(|_| CheckResult {
        step: CheckStep::Microphone,
        status: CheckStatus::Failed,
        duration_ms: 0,
        error_code: Some(ErrorCode::Internal),
        detail: "Проверка прервана".into(),
    }));
    checks.push(configured_stt_result(&settings));
    checks.push(answer_result(&app, model).await);
    PreflightReport { checks }
}
