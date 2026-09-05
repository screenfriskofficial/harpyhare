use crate::sync::LockUnpoisoned;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Manager};
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

use crate::app_state::{llm_provider, note_connectivity_probe, ActiveLlmStream, App};
use crate::error::AppError;
use crate::{events, llm};

/// Окно коалесинга дельт: флашер просыпается по первой дельте и отдаёт всё,
/// что накопилось за это время, одним событием.
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

/// Регистрирует стрим и отдаёт его токен отмены. Прежний стрим чата
/// отменяется. Если на месте прежнего лежит надгробие с ТЕМ ЖЕ `stream_id`
/// (отмена приехала раньше регистрации — `cancel_stream` синхронна, а
/// `send_to_claude` стартует на рабочем потоке), новый токен гасится сразу.
fn register_in(map: &mut StreamRegistry, chat_id: &str, stream_id: &str) -> CancellationToken {
    let cancel = CancellationToken::new();
    let entry = ActiveLlmStream { stream_id: stream_id.to_string(), cancel: cancel.clone() };
    if let Some(old) = replace_stream(map, chat_id, entry) {
        old.cancel.cancel();
        if old.stream_id == stream_id {
            cancel.cancel();
        }
    }
    cancel
}

/// Отменяет стрим, если в реестре лежит именно он. Отмена стрима, которого
/// ещё нет, оставляет надгробие — уже отменённый токен под его `stream_id`,
/// чтобы запоздавшая регистрация увидела её; чужой активный стрим при этом
/// не трогается.
fn cancel_in(map: &mut StreamRegistry, chat_id: &str, stream_id: &str) {
    if let Some(stream) = take_stream(map, chat_id, stream_id) {
        stream.cancel.cancel();
        return;
    }
    if map.contains_key(chat_id) {
        return;
    }
    let tombstone = CancellationToken::new();
    tombstone.cancel();
    replace_stream(map, chat_id, ActiveLlmStream { stream_id: stream_id.to_string(), cancel: tombstone });
}

fn register_llm_cancel(app: &AppHandle, chat_id: &str, stream_id: &str) -> CancellationToken {
    let st = app.state::<App>();
    let mut map = st.llm_cancel.lock_unpoisoned();
    register_in(&mut map, chat_id, stream_id)
}

fn unregister_llm_cancel(app: &AppHandle, chat_id: &str, stream_id: &str) {
    let st = app.state::<App>();
    take_stream(&mut st.llm_cancel.lock_unpoisoned(), chat_id, stream_id);
}

/// Отменяет все активные стримы: HUD закрывается, читать дельты некому.
pub fn cancel_all_streams(app: &AppHandle) {
    let st = app.state::<App>();
    let streams: Vec<ActiveLlmStream> = st.llm_cancel.lock_unpoisoned().drain().map(|(_, s)| s).collect();
    for stream in streams {
        stream.cancel.cancel();
    }
}

struct LlmDeltaFlusher {
    pending: Arc<Mutex<String>>,
    wake: Arc<Notify>,
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
    let wake = Arc::new(Notify::new());
    let stop = CancellationToken::new();
    let task = {
        let pending = Arc::clone(&pending);
        let wake = Arc::clone(&wake);
        let stop = stop.clone();
        tauri::async_runtime::spawn(async move {
            run_llm_delta_flusher(app, chat_id, stream_id, pending, wake, stop).await;
        })
    };
    LlmDeltaFlusher { pending, wake, stop, task }
}

/// Спит, пока дельт нет (минуты тихого рассуждения — ни одного пробуждения),
/// а по первой дельте выжидает окно коалесинга и отдаёт накопленное. Раньше
/// тикал 40 раз в секунду весь стрим. Финальный дрен уходит ДО `llm-done` —
/// это инвариант, на котором держится хвост ответа во фронте.
async fn run_llm_delta_flusher(
    app: AppHandle,
    chat_id: String,
    stream_id: String,
    pending: Arc<Mutex<String>>,
    wake: Arc<Notify>,
    stop: CancellationToken,
) {
    loop {
        tokio::select! {
            () = wake.notified() => {}
            () = stop.cancelled() => break,
        }
        tokio::time::sleep(LLM_DELTA_FLUSH_INTERVAL).await;
        flush_pending_delta(&app, &chat_id, &stream_id, &pending);
    }
    flush_pending_delta(&app, &chat_id, &stream_id, &pending);
}

fn flush_pending_delta(app: &AppHandle, chat_id: &str, stream_id: &str, pending: &Mutex<String>) {
    let delta = std::mem::take(&mut *pending.lock_unpoisoned());
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
    wake: Arc<Notify>,
    started: std::time::Instant,
    got_first_delta: bool,
}

impl llm::LlmStreamSink for ChatStreamSink {
    fn text_delta(&mut self, delta: &str) {
        if !self.got_first_delta {
            self.got_first_delta = true;
            eprintln!(
                "[perf] llm ttfb (первая текстовая дельта) {:?}",
                self.started.elapsed()
            );
        }
        self.pending.lock_unpoisoned().push_str(delta);
        self.wake.notify_one();
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
        wake: Arc::clone(&flusher.wake),
        started,
        got_first_delta: false,
    };
    let res = provider.stream(request, cancel, &mut sink).await;
    flusher.stop_and_await_final_drain().await;
    eprintln!("[perf] llm stream total {:?}", started.elapsed());
    unregister_llm_cancel(&app, &chat_id, &stream_id);
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
    cancel_in(&mut st.llm_cancel.lock_unpoisoned(), &chat_id, &stream_id);
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
        _ => app.state::<App>().models.lock_unpoisoned().clone(),
    }
}

#[cfg(test)]
mod tests;
