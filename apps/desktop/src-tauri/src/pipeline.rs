//! Isolated model steps for prompt and message pipelines. The domain runner owns
//! graph order; this boundary owns credentials, complete output and cancellation.
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Mutex;

use tauri::{AppHandle, Manager};
use tokio_util::sync::CancellationToken;

use crate::app_state::llm_provider;
use crate::diagnostics::{self, DiagnosticOrigin, Trace};
use crate::error::{AppError, CodedError, ErrorCode};
use crate::llm::{ChatMessage, LlmProvider, LlmRequest, LlmStreamSink, RequestOptions};
use crate::sync::LockUnpoisoned;

// Run ids are unique for the entire frontend execution. Keep recent cancelled
// ids even between steps: cancel may reach Rust before an already queued invoke.
const CANCELLED_RUN_LIMIT: usize = 256;
const MAX_ACTIVE_RUNS: usize = 32;
const MAX_ACTIVE_STEPS_PER_RUN: usize = 32;
const MAX_IDENTIFIER_BYTES: usize = 256;

#[derive(Default)]
struct RunRegistry {
    active: HashMap<String, ActiveRun>,
    cancelled: VecDeque<String>,
}

struct ActiveRun {
    cancel: CancellationToken,
    nodes: HashSet<String>,
}

impl RunRegistry {
    fn begin(&mut self, run_id: &str, node_id: &str) -> Result<CancellationToken, AppError> {
        if self.cancelled.iter().any(|id| id == run_id) {
            return Err(cancelled_error());
        }
        // The limits guard against a frontend that lost track of its runs, not
        // against a busy service: nothing about them clears by waiting.
        if !self.active.contains_key(run_id) && self.active.len() >= MAX_ACTIVE_RUNS {
            return Err(AppError::new(
                ErrorCode::Internal,
                "Слишком много активных запусков схемы",
            ));
        }
        let run = self
            .active
            .entry(run_id.into())
            .or_insert_with(|| ActiveRun {
                cancel: CancellationToken::new(),
                nodes: HashSet::new(),
            });
        // An active cancelled run stays cancelled even after its bounded
        // tombstone has been evicted by newer runs.
        if run.cancel.is_cancelled() {
            return Err(cancelled_error());
        }
        if run.nodes.len() >= MAX_ACTIVE_STEPS_PER_RUN || !run.nodes.insert(node_id.into()) {
            return Err(AppError::new(
                ErrorCode::Internal,
                "Шаг схемы уже выполняется",
            ));
        }
        Ok(run.cancel.child_token())
    }

    fn cancel(&mut self, run_id: &str) {
        if let Some(run) = self.active.get(run_id) {
            run.cancel.cancel();
        }
        self.cancelled.retain(|id| id != run_id);
        self.cancelled.push_back(run_id.into());
        while self.cancelled.len() > CANCELLED_RUN_LIMIT {
            self.cancelled.pop_front();
        }
    }

    fn finish(&mut self, run_id: &str, node_id: &str) {
        if let Some(run) = self.active.get_mut(run_id) {
            run.nodes.remove(node_id);
            if run.nodes.is_empty() {
                self.active.remove(run_id);
            }
        }
    }
}

#[derive(Default)]
pub struct PipelineState(Mutex<RunRegistry>);

struct StepGuard {
    app: AppHandle,
    run_id: String,
    node_id: String,
    cancel: CancellationToken,
}

impl Drop for StepGuard {
    fn drop(&mut self) {
        self.cancel.cancel();
        self.app
            .state::<PipelineState>()
            .0
            .lock_unpoisoned()
            .finish(&self.run_id, &self.node_id);
    }
}

struct StepSink {
    text: String,
    trace: Option<Trace>,
}

impl StepSink {
    fn new(trace: Option<Trace>) -> Self {
        Self {
            text: String::new(),
            trace,
        }
    }
}

impl LlmStreamSink for StepSink {
    fn text_delta(&mut self, delta: &str) {
        if let Some(trace) = &self.trace {
            trace.first_text(delta);
        }
        self.text.push_str(delta);
    }
}

fn cancelled_error() -> AppError {
    AppError::new(ErrorCode::Cancelled, "Запуск схемы остановлен")
}

fn validate_identifier(id: &str) -> Result<(), AppError> {
    if id.trim().is_empty() || id.len() > MAX_IDENTIFIER_BYTES {
        Err(AppError::new(
            ErrorCode::Internal,
            "Некорректный идентификатор запуска или узла схемы",
        ))
    } else {
        Ok(())
    }
}

/// One model call, recorded in diagnostics like a chat answer when a trace is
/// given (unit tests run without one).
async fn complete_step(
    provider: &dyn LlmProvider,
    request: LlmRequest,
    cancel: CancellationToken,
    trace: Option<Trace>,
) -> Result<String, AppError> {
    if cancel.is_cancelled() {
        return Err(cancelled_error());
    }
    let mut sink = StepSink::new(trace.clone());
    let result = match &trace {
        Some(trace) => {
            trace
                .scope(provider.stream(request, cancel.clone(), &mut sink))
                .await
        }
        None => provider.stream(request, cancel.clone(), &mut sink).await,
    };
    if let Some(trace) = &trace {
        trace.finish(result.as_ref().err().map(CodedError::code));
    }
    // A terminal SSE event can win the select just as Stop arrives. A partial
    // or cancelled result must never become an input of the next graph node.
    if cancel.is_cancelled() {
        return Err(cancelled_error());
    }
    result.map_err(|error| AppError::from(&error))?;
    if sink.text.trim().is_empty() {
        return Err(AppError::new(
            ErrorCode::Api,
            "Модель не вернула текст ответа",
        ));
    }
    Ok(sink.text)
}

#[tauri::command]
#[specta::specta]
pub async fn run_pipeline_step(
    app: AppHandle,
    run_id: String,
    node_id: String,
    messages: Vec<ChatMessage>,
    system: String,
    model: String,
    options: RequestOptions,
) -> Result<String, AppError> {
    validate_identifier(&run_id)?;
    validate_identifier(&node_id)?;
    if model.trim().is_empty() {
        return Err(AppError::new(
            ErrorCode::ModelUnavailable,
            "Выберите модель для шага схемы",
        ));
    }
    let cancel = app
        .state::<PipelineState>()
        .0
        .lock_unpoisoned()
        .begin(&run_id, &node_id)?;
    let provider = llm_provider(&app);
    let trace = diagnostics::answer_trace(&app, &model, DiagnosticOrigin::Pipeline);
    let guard = StepGuard {
        app,
        run_id,
        node_id,
        cancel,
    };
    complete_step(
        provider.as_ref(),
        LlmRequest {
            model,
            system,
            messages,
            options,
        },
        guard.cancel.clone(),
        Some(trace),
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub fn cancel_pipeline_run(app: AppHandle, run_id: String) {
    if validate_identifier(&run_id).is_ok() {
        app.state::<PipelineState>()
            .0
            .lock_unpoisoned()
            .cancel(&run_id);
    }
}

#[cfg(test)]
mod tests;
