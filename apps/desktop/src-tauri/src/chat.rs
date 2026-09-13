use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Manager};
use tokio_util::sync::CancellationToken;

use crate::app_state::{llm_provider, note_connectivity_probe, ActiveLlmStream, App};
use crate::error::AppError;
use crate::{events, llm};

const LLM_DELTA_FLUSH_INTERVAL: Duration = Duration::from_millis(25);

type StreamRegistry = HashMap<String, ActiveLlmStream>;

fn replace_stream(
    map: &mut StreamRegistry,
    chat_id: &str,
    entry: ActiveLlmStream,
) -> Option<ActiveLlmStream> {
    map.insert(chat_id.to_string(), entry)
}

fn take_stream(
    map: &mut StreamRegistry,
    chat_id: &str,
    stream_id: &str,
) -> Option<ActiveLlmStream> {
    if !map.get(chat_id).is_some_and(|s| s.stream_id == stream_id) {
        return None;
    }
    map.remove(chat_id)
}

fn register_llm_cancel(app: &AppHandle, chat_id: &str, stream_id: &str) -> CancellationToken {
    let cancel = CancellationToken::new();
    let entry = ActiveLlmStream {
        stream_id: stream_id.to_string(),
        cancel: cancel.clone(),
    };
    let st = app.state::<App>();
    let mut map = st.llm_cancel.lock().unwrap();
    if let Some(old) = replace_stream(&mut map, chat_id, entry) {
        old.cancel.cancel();
    }
    cancel
}

fn unregister_llm_cancel(app: &AppHandle, chat_id: &str, stream_id: &str) {
    let st = app.state::<App>();
    take_stream(&mut st.llm_cancel.lock().unwrap(), chat_id, stream_id);
}

struct LlmDeltaFlusher {
    pending: Arc<Mutex<String>>,
    stop: CancellationToken,
    task: tauri::async_runtime::JoinHandle<()>,
}

impl LlmDeltaFlusher {
    async fn stop_and_await_final_drain(self) {
        self.stop.cancel();
        let _ = self.task.await;
    }
}

fn spawn_llm_delta_flusher(app: AppHandle, chat_id: String, stream_id: String) -> LlmDeltaFlusher {
    let pending = Arc::new(Mutex::new(String::new()));
    let stop = CancellationToken::new();
    let task = {
        let pending = Arc::clone(&pending);
        let stop = stop.clone();
        tauri::async_runtime::spawn(async move {
            run_llm_delta_flusher(app, chat_id, stream_id, pending, stop).await;
        })
    };
    LlmDeltaFlusher {
        pending,
        stop,
        task,
    }
}

async fn run_llm_delta_flusher(
    app: AppHandle,
    chat_id: String,
    stream_id: String,
    pending: Arc<Mutex<String>>,
    stop: CancellationToken,
) {
    let mut tick = tokio::time::interval(LLM_DELTA_FLUSH_INTERVAL);
    loop {
        tokio::select! {
            _ = tick.tick() => {}
            _ = stop.cancelled() => break,
        }
        flush_pending_delta(&app, &chat_id, &stream_id, &pending);
    }
    flush_pending_delta(&app, &chat_id, &stream_id, &pending);
}

fn flush_pending_delta(app: &AppHandle, chat_id: &str, stream_id: &str, pending: &Mutex<String>) {
    let delta = std::mem::take(&mut *pending.lock().unwrap());
    if !delta.is_empty() {
        events::llm_delta(app, chat_id, stream_id, delta);
    }
}

fn emit_llm_result(
    app: &AppHandle,
    chat_id: String,
    stream_id: String,
    res: Result<(), llm::LlmError>,
) {
    match res {
        Ok(()) | Err(llm::LlmError::Cancelled) => events::llm_done(app, chat_id, stream_id),
        Err(e) => events::llm_error(app, chat_id, stream_id, AppError::from(&e)),
    }
}

struct ChatStreamSink {
    app: AppHandle,
    chat_id: String,
    stream_id: String,
    pending: Arc<Mutex<String>>,
    started: std::time::Instant,
    got_first_delta: bool,
    trace: crate::diagnostics::Trace,
}

impl llm::LlmStreamSink for ChatStreamSink {
    fn text_delta(&mut self, delta: &str) {
        if !self.got_first_delta {
            self.got_first_delta = true;
            self.trace.first_text(delta);
            eprintln!(
                "[perf] llm ttfb (первая текстовая дельта) {:?}",
                self.started.elapsed()
            );
        }
        self.pending.lock().unwrap().push_str(delta);
    }

    fn input_tokens(&mut self, total: u32) {
        events::llm_usage(&self.app, &self.chat_id, &self.stream_id, total);
    }
}

#[tauri::command]
#[specta::specta]
pub async fn send_to_claude(
    app: AppHandle,
    messages: Vec<llm::ChatMessage>,
    chat_id: String,
    stream_id: String,
    system: String,
    model: String,
    options: llm::RequestOptions,
) {
    let provider = llm_provider(&app);
    let trace = crate::diagnostics::Trace::new(
        crate::diagnostics::DiagnosticKind::Answer,
        crate::diagnostics::DiagnosticOrigin::Session,
        provider.provider_id(),
        &model,
    );
    let cancel = register_llm_cancel(&app, &chat_id, &stream_id);
    let request = llm::LlmRequest {
        model,
        system,
        messages,
        options,
    };

    let flusher = spawn_llm_delta_flusher(app.clone(), chat_id.clone(), stream_id.clone());
    let started = std::time::Instant::now();
    let mut sink = ChatStreamSink {
        app: app.clone(),
        chat_id: chat_id.clone(),
        stream_id: stream_id.clone(),
        pending: Arc::clone(&flusher.pending),
        started,
        got_first_delta: false,
        trace: trace.clone(),
    };
    let res = trace
        .scope(provider.stream(request, cancel, &mut sink))
        .await;
    flusher.stop_and_await_final_drain().await;
    eprintln!("[perf] llm stream total {:?}", started.elapsed());
    unregister_llm_cancel(&app, &chat_id, &stream_id);
    let error_code = res.as_ref().err().map(crate::error::CodedError::code);
    trace.finish(error_code);
    emit_llm_result(&app, chat_id, stream_id, res);
}

#[tauri::command]
#[specta::specta]
pub async fn count_chat_tokens(
    app: AppHandle,
    messages: Vec<llm::ChatMessage>,
    system: String,
    model: String,
    options: llm::RequestOptions,
) -> Result<u32, String> {
    llm_provider(&app)
        .count_tokens(llm::LlmRequest {
            model,
            system,
            messages,
            options,
        })
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn cancel_stream(app: AppHandle, chat_id: String, stream_id: String) {
    let st = app.state::<App>();
    let taken = take_stream(&mut st.llm_cancel.lock().unwrap(), &chat_id, &stream_id);
    if let Some(s) = taken {
        s.cancel.cancel();
    }
}

#[tauri::command]
#[specta::specta]
pub async fn probe_connectivity(app: AppHandle) -> bool {
    let reachable = llm_provider(&app).reachable().await;
    note_connectivity_probe(&app, reachable);
    reachable
}

#[tauri::command]
#[specta::specta]
pub async fn list_models(app: AppHandle) -> Vec<llm::ModelInfo> {
    match llm_provider(&app).list_models().await {
        Ok(models) if !models.is_empty() => models,
        _ => app.state::<App>().models.lock().unwrap().clone(),
    }
}

#[cfg(test)]
mod tests;
