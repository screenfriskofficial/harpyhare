use crate::sync::LockUnpoisoned;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;

use futures_util::FutureExt;
use tauri::{AppHandle, Manager};
use tokio_util::sync::CancellationToken;

use crate::app_state::{
    build_capture, cancel_stt_stream, current_settings, llm_provider, stt_engine, stt_keyterms,
    App, SttStream,
};
use crate::error::{AppError, ErrorCode};
use crate::{audio, capture, events, global_shortcuts, state, stt};

/// Платформенные тексты — одно значение на платформу, не ветка логики.
const ERR_NO_CAPTURE: (ErrorCode, &str) = if cfg!(target_os = "macos") {
    (ErrorCode::Permission, "Нет разрешения на запись системного звука")
} else {
    (
        ErrorCode::Internal,
        "Захват системного звука недоступен — проверь устройство вывода в настройках",
    )
};
const ERR_NO_AUDIO_BUFFER: &str = "нет аудио-буфера";
const ERR_SILENCE: &str = if cfg!(target_os = "macos") {
    "Тишина — нечего распознавать (если звук играл: проверь право «Запись системного звука» у macOS и устройство захвата в настройках)"
} else {
    "Тишина — нечего распознавать (если звук играл: проверь устройство вывода в настройках захвата)"
};
const ERR_NO_SPEECH: &str = "В записи не нашлось слов — нечего вставлять";
const ERR_TRANSCRIPTION_CRASHED: &str = "Расшифровка прервалась внутренней ошибкой";

/// Ёмкость канала к STT-стриму в чанках по `STT_CHUNK_TARGET_BYTES`: столько
/// секунд столла сети конвейер переживёт, не помечая стрим `broken`.
const STT_STREAM_CHANNEL_CAPACITY: usize = 256;
/// Кадры с капчера идут по ~21 мс; в сеть они склеиваются до ~100 мс —
/// впятеро меньше WebSocket-кадров и HTTP DATA-фреймов на ту же речь.
const STT_CHUNK_TARGET_BYTES: usize = 3200;
const MAX_DURATION_WATCHDOG_INTERVAL: Duration = Duration::from_secs(1);
/// Сколько ждать ответ уже открытого стрима после отпускания клавиши, прежде
/// чем уйти в батчевый фолбэк: «отпустил → текст» это инференс плюс RTT.
const STREAM_FINISH_TIMEOUT: Duration = Duration::from_secs(60);

type SttBodyChunk = Result<Vec<u8>, std::io::Error>;

/// Событие push-to-talk. Обрабатываются СТРОГО по очереди одним воркером:
/// раньше каждое уходило своей задачей в рантайм, и короткий тап, чьё
/// «нажато» задержалось на пересборке капчера, обрабатывал «отпущено» раньше
/// «нажато» — запись стартовала, и отпускать её было некому.
#[derive(Debug, Clone, Copy)]
pub enum PttEvent {
    Pressed,
    Released,
    Cancel,
    MaxDurationReached { generation: u64 },
}

/// Заводит воркер PTT-событий; зовётся один раз из `setup_app`.
pub fn install_ptt_worker(app: &AppHandle) {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<PttEvent>();
    if app.state::<App>().ptt_events.set(tx).is_err() {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            let app = app.clone();
            // Обработчики блокируют (старт и стоп капчера ждут консьюмер) —
            // им место на blocking-пуле, а не на воркере рантайма.
            let _ = tauri::async_runtime::spawn_blocking(move || handle_ptt_event(&app, event)).await;
        }
    });
}

pub fn enqueue_ptt(app: &AppHandle, event: PttEvent) {
    match app.state::<App>().ptt_events.get() {
        Some(tx) => {
            let _ = tx.send(event);
        }
        None => eprintln!("PTT-событие {event:?} пришло до запуска воркера"),
    }
}

fn handle_ptt_event(app: &AppHandle, event: PttEvent) {
    match event {
        PttEvent::Pressed => on_ptt_pressed(app),
        PttEvent::Released => on_ptt_released(app),
        PttEvent::Cancel => on_cancel(app),
        PttEvent::MaxDurationReached { generation } => on_max_duration_reached(app, generation),
    }
}

pub fn install_default_output_device_listener(app: &AppHandle) {
    let app = app.clone();
    capture::watch_default_output_device(Box::new(move || {
        handle_default_output_device_changed(&app);
    }));
}

fn handle_default_output_device_changed(app: &AppHandle) {
    let follows_system_default =
        app.state::<App>().settings.lock_unpoisoned().capture_device_uid.is_empty();
    if follows_system_default {
        request_capture_rebuild(app);
    }
}

/// Пересобрать капчер, когда рекордер свободен; занят — на следующем PTT.
/// Сама пересборка уходит на blocking-пул: создание тапа или WASAPI-потока
/// стоит сотен миллисекунд, и на главном потоке это был фриз UI.
pub fn request_capture_rebuild(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || rebuild_capture_if_idle(&app));
}

/// Решение и подмена — под `recorder`-локом: между проверкой «свободен» и
/// подменой капчера раньше успевало пройти нажатие PTT, которое стартовало
/// запись на старом капчере, тут же дропнутом посреди сессии.
fn rebuild_capture_if_idle(app: &AppHandle) {
    let st = app.state::<App>();
    let recorder = st.recorder.lock_unpoisoned();
    if *recorder != state::RecorderState::Idle {
        st.capture_rebuild_pending.store(true, Ordering::SeqCst);
        return;
    }
    rebuild_capture_now(app);
}

pub fn rebuild_capture(app: &AppHandle) -> bool {
    let st = app.state::<App>();
    let new_capture = build_capture(&current_settings(app));
    let built = new_capture.is_some();
    // Старый капчер дропается ВНЕ лока: его `Drop` джойнит потоки, и держать
    // на это время `App.capture` значило бы морозить всех, кто его ждёт.
    let old = std::mem::replace(&mut *st.capture.lock_unpoisoned(), new_capture);
    drop(old);
    built
}

pub fn ensure_capture(app: &AppHandle) -> bool {
    if app.state::<App>().capture.lock_unpoisoned().is_some() {
        return true;
    }
    rebuild_capture(app)
}

fn rebuild_capture_now(app: &AppHandle) {
    let never_built = app.state::<App>().capture.lock_unpoisoned().is_none();
    let would_prompt = crate::permissions::AUDIO_REQUIRES_PERMISSION
        && !current_settings(app).audio_permission_requested;
    if never_built && would_prompt {
        return;
    }
    rebuild_capture(app);
}

fn capture_is_dead(st: &App) -> bool {
    st.capture.lock_unpoisoned().as_ref().is_some_and(capture::SystemAudioCapture::is_dead)
}

pub fn on_ptt_pressed(app: &AppHandle) {
    let st = app.state::<App>();
    // Под `recorder`-локом на всё нажатие: пересборка капчера и старт записи
    // не должны перемежаться ни с другой пересборкой, ни с отпусканием.
    let mut recorder = st.recorder.lock_unpoisoned();
    if st.capture_rebuild_pending.swap(false, Ordering::SeqCst) || capture_is_dead(&st) {
        rebuild_capture_now(app);
    }
    if st.capture.lock_unpoisoned().is_none() {
        events::stt_error(
            app,
            AppError::new(ERR_NO_CAPTURE.0, ERR_NO_CAPTURE.1),
        );
        return;
    }
    let action = recorder.on(state::Event::PttPressed);
    if action != state::Action::StartCapture {
        return;
    }
    let sink = start_streaming_transcription(app);
    if let Some(c) = st.capture.lock_unpoisoned().as_mut() {
        if let Err(e) = c.start(Some(sink)) {
            cancel_stt_stream(app);
            events::stt_error(app, AppError::from(&e));
            recorder.on(state::Event::Cancel);
            return;
        }
    }
    drop(recorder);
    let generation = st.recording_gen.fetch_add(1, Ordering::SeqCst) + 1;
    global_shortcuts::register_cancel(app, &global_shortcuts::cancel_combo(app));
    events::state_changed(app, state::RecorderState::Recording);
    spawn_max_duration_watchdog(app.clone(), generation);
    warm_up_llm_for_upcoming_request(app);
}

/// Склеивает кадры капчера в чанки покрупнее и отдаёт их в канал стрима.
/// Хвост уходит в `Drop`: капчер дропает sink на остановке — это EOF стрима,
/// и последние миллисекунды речи не должны в нём потеряться.
struct ChunkCoalescer {
    pending: Vec<u8>,
    tx: tokio::sync::mpsc::Sender<SttBodyChunk>,
    broken: Arc<AtomicBool>,
}

impl ChunkCoalescer {
    fn push(&mut self, samples: &[f32]) {
        if self.broken.load(Ordering::Relaxed) {
            return;
        }
        self.pending.extend_from_slice(&audio::f32_to_i16le_bytes(samples));
        if self.pending.len() >= STT_CHUNK_TARGET_BYTES {
            self.flush();
        }
    }

    fn flush(&mut self) {
        if self.pending.is_empty() || self.broken.load(Ordering::Relaxed) {
            return;
        }
        let chunk = std::mem::take(&mut self.pending);
        if self.tx.try_send(Ok(chunk)).is_err() {
            self.broken.store(true, Ordering::Relaxed);
        }
    }
}

impl Drop for ChunkCoalescer {
    fn drop(&mut self) {
        self.flush();
    }
}

fn start_streaming_transcription(app: &AppHandle) -> capture::ChunkSink {
    let st = app.state::<App>();
    let stt_client = stt_engine(app);
    let keyterms = stt_keyterms(app);
    let cancel = CancellationToken::new();
    let broken = Arc::new(AtomicBool::new(false));
    let (tx, rx) = tokio::sync::mpsc::channel::<SttBodyChunk>(STT_STREAM_CHANNEL_CAPACITY);
    let body_stream: stt::AudioChunkStream = Box::pin(futures_util::stream::unfold(
        rx,
        |mut rx| async move { rx.recv().await.map(|item| (item, rx)) },
    ));
    let handle = {
        let cancel = cancel.clone();
        tauri::async_runtime::spawn(
            async move { stt_client.transcribe_stream(body_stream, &keyterms, cancel).await },
        )
    };
    if let Some(old) = st.stt_stream.lock_unpoisoned().replace(SttStream {
        handle,
        cancel,
        broken: Arc::clone(&broken),
    }) {
        old.cancel.cancel();
    }
    let mut coalescer = ChunkCoalescer { pending: Vec::with_capacity(STT_CHUNK_TARGET_BYTES * 2), tx, broken };
    Box::new(move |samples: &[f32]| coalescer.push(samples))
}

fn warm_up_llm_for_upcoming_request(app: &AppHandle) {
    let llm_client = llm_provider(app);
    tauri::async_runtime::spawn(async move { llm_client.warm_up().await });
}

fn current_recording_secs(st: &App) -> f32 {
    st.capture
        .lock_unpoisoned()
        .as_ref()
        .map(|c| c.recording_secs())
        .unwrap_or(0.0)
}

fn stop_capture_discarding(st: &App) {
    if let Some(c) = st.capture.lock_unpoisoned().as_mut() {
        let _ = c.stop();
    }
}

pub fn on_ptt_released(app: &AppHandle) {
    let st = app.state::<App>();
    let secs = current_recording_secs(&st);
    let action = st
        .recorder
        .lock_unpoisoned()
        .on(state::Event::PttReleased { duration_secs: secs });
    global_shortcuts::unregister_cancel(app, &global_shortcuts::cancel_combo(app));
    finish_recording(app, action);
}

pub fn on_cancel(app: &AppHandle) {
    let st = app.state::<App>();
    let action = st.recorder.lock_unpoisoned().on(state::Event::Cancel);
    if action == state::Action::Discard {
        cancel_stt_stream(app);
        stop_capture_discarding(&st);
        global_shortcuts::unregister_cancel(app, &global_shortcuts::cancel_combo(app));
        events::state_changed(app, state::RecorderState::Idle);
    }
}

fn on_max_duration_reached(app: &AppHandle, generation: u64) {
    let st = app.state::<App>();
    if st.recording_gen.load(Ordering::SeqCst) != generation {
        return;
    }
    let action = st.recorder.lock_unpoisoned().on(state::Event::MaxDurationReached);
    if action == state::Action::None {
        return;
    }
    global_shortcuts::unregister_cancel(app, &global_shortcuts::cancel_combo(app));
    finish_recording(app, action);
}

fn finish_recording(app: &AppHandle, action: state::Action) {
    match action {
        state::Action::Discard => {
            cancel_stt_stream(app);
            stop_capture_discarding(&app.state::<App>());
            events::state_changed(app, state::RecorderState::Idle);
        }
        state::Action::Transcribe => transcribe_recording(app),
        _ => {}
    }
}

fn transcribe_recording(app: &AppHandle) {
    events::state_changed(app, state::RecorderState::Transcribing);
    let s16k = match stop_capture_for_transcription(app) {
        Ok(v) => v,
        Err(msg) => {
            cancel_stt_stream(app);
            return finish_transcription(app, Err(msg));
        }
    };
    if audio::is_silence(&s16k) {
        cancel_stt_stream(app);
        return finish_transcription(app, Err(AppError::new(ErrorCode::Silence, ERR_SILENCE)));
    }
    let s16k: Arc<[f32]> = s16k.into();
    *app.state::<App>().last_recording.lock_unpoisoned() = Some(Arc::clone(&s16k));
    spawn_supervised_transcription(app.clone(), s16k);
}

/// Задача расшифровки под надзором: паника внутри неё раньше глоталась
/// рантаймом, `TranscriptionFinished` не приходил, и рекордер оставался в
/// «Расшифровка» навсегда — вотчдог покрывает только запись.
fn spawn_supervised_transcription(app: AppHandle, samples: Arc<[f32]>) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = supervise_transcription(finish_transcribe(app.clone(), samples)).await {
            finish_transcription(&app, Err(error));
        }
    });
}

/// Initial recognition and retries must both release the recorder after a
/// provider panic. Otherwise the retry path stays in Transcribing forever.
async fn supervise_transcription(task: impl std::future::Future<Output = ()>) -> Result<(), AppError> {
    std::panic::AssertUnwindSafe(task).catch_unwind().await.map_err(|_| {
        eprintln!("расшифровка упала паникой — рекордер возвращён в покой");
        AppError::new(ErrorCode::Internal, ERR_TRANSCRIPTION_CRASHED)
    })
}

fn stop_capture_for_transcription(app: &AppHandle) -> Result<Vec<f32>, AppError> {
    let t = std::time::Instant::now();
    let stopped = app
        .state::<App>()
        .capture
        .lock_unpoisoned()
        .as_mut()
        .map(|c| c.stop());
    let Some(stopped) = stopped else {
        return Err(AppError::new(ErrorCode::Internal, ERR_NO_AUDIO_BUFFER));
    };
    let s16k = stopped.map_err(|e| AppError::from(&e))?;
    eprintln!(
        "[perf] stop → 16k моно готов ({:.1}s audio) за {:?}",
        s16k.len() as f32 / audio::TARGET_SAMPLE_RATE as f32,
        t.elapsed()
    );
    Ok(s16k)
}

/// Что делать с исходом стримингового запроса.
#[derive(Debug)]
enum StreamVerdict {
    Deliver(String),
    /// Ключ или код доступа неверны — батч ответил бы тем же; в фолбэк не идём.
    Fail(stt::SttError),
    FallBack,
}

fn stream_verdict(outcome: Result<String, stt::SttError>) -> StreamVerdict {
    match outcome {
        Ok(text) => StreamVerdict::Deliver(text),
        Err(e @ (stt::SttError::BadApiKey(_) | stt::SttError::BadAccessCode(_))) => StreamVerdict::Fail(e),
        Err(_) => StreamVerdict::FallBack,
    }
}

async fn settle_stream(stream: SttStream) -> StreamVerdict {
    let SttStream { handle, cancel, broken } = stream;
    // Стрим неполон, но уже мог закончиться — например, мгновенным 401.
    // Такой исход честнее прочитать, чем гнать полную батч-загрузку ради
    // того же ответа.
    if broken.load(Ordering::Relaxed) && !handle.inner().is_finished() {
        eprintln!("[perf] stt stream неполон — фолбэк на классическую загрузку");
        cancel.cancel();
        return StreamVerdict::FallBack;
    }
    match tokio::time::timeout(STREAM_FINISH_TIMEOUT, handle).await {
        Ok(Ok(outcome)) => {
            if broken.load(Ordering::Relaxed) && outcome.is_ok() {
                return StreamVerdict::FallBack;
            }
            stream_verdict(outcome)
        }
        Ok(Err(e)) => {
            eprintln!("[perf] stt stream задача упала ({e}) — фолбэк на классику");
            StreamVerdict::FallBack
        }
        Err(_) => {
            eprintln!("[perf] stt stream не ответил за {STREAM_FINISH_TIMEOUT:?} — фолбэк на классику");
            cancel.cancel();
            StreamVerdict::FallBack
        }
    }
}

async fn finish_transcribe(app: AppHandle, samples: Arc<[f32]>) {
    let t = std::time::Instant::now();
    let stream = app.state::<App>().stt_stream.lock_unpoisoned().take();
    if let Some(s) = stream {
        match settle_stream(s).await {
            StreamVerdict::Deliver(text) => {
                eprintln!("[perf] stop → transcript (stream) {:?}", t.elapsed());
                return deliver_transcript(&app, text);
            }
            StreamVerdict::Fail(e) => return finish_transcription(&app, Err(AppError::from(&e))),
            StreamVerdict::FallBack => {}
        }
    }
    transcribe_and_emit(app, samples).await;
}

/// Пустая расшифровка — не результат, а «слов не нашлось»: вставлять нечего,
/// и пользователь должен это увидеть, а не получить пустое событие.
fn deliver_transcript(app: &AppHandle, text: String) {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    if text.trim().is_empty() {
        return finish_transcription(app, Err(AppError::new(ErrorCode::Silence, ERR_NO_SPEECH)));
    }
    let _ = app.clipboard().write_text(text.clone());
    events::transcript_ready(app, text);
    events::focus_prompt(app);
    finish_transcription(app, Ok(()));
}

async fn transcribe_and_emit(app: AppHandle, samples: Arc<[f32]>) {
    let stt_client = stt_engine(&app);
    let keyterms = stt_keyterms(&app);
    let t = std::time::Instant::now();
    let res = stt_client.transcribe(&samples, &keyterms).await;
    eprintln!("[perf] stt transcribe (wav+upload+inference) {:?}", t.elapsed());
    match res {
        Ok(text) => deliver_transcript(&app, text),
        Err(e) => finish_transcription(&app, Err(AppError::from(&e))),
    }
}

fn finish_transcription(app: &AppHandle, result: Result<(), AppError>) {
    let st = app.state::<App>();
    st.recorder
        .lock_unpoisoned()
        .on(state::Event::TranscriptionFinished);
    if let Err(err) = result {
        events::stt_error(app, err);
    }
    events::state_changed(app, state::RecorderState::Idle);
}

/// Следит за десятиминутным потолком записи. Само решение уходит в очередь
/// PTT-событий — тем же путём, что нажатия, чтобы не перемежаться с ними.
fn spawn_max_duration_watchdog(app: AppHandle, my_gen: u64) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(MAX_DURATION_WATCHDOG_INTERVAL).await;
            let st = app.state::<App>();
            if st.recording_gen.load(Ordering::SeqCst) != my_gen {
                break;
            }
            if *st.recorder.lock_unpoisoned() != state::RecorderState::Recording {
                break;
            }
            if current_recording_secs(&st) >= state::MAX_RECORDING_SECS {
                enqueue_ptt(&app, PttEvent::MaxDurationReached { generation: my_gen });
                break;
            }
        }
    });
}

#[tauri::command]
#[specta::specta]
pub async fn retry_transcription(app: AppHandle) {
    let samples = app.state::<App>().last_recording.lock_unpoisoned().clone();
    let Some(s) = samples else { return };
    {
        let st = app.state::<App>();
        let mut rec = st.recorder.lock_unpoisoned();
        if *rec != state::RecorderState::Idle {
            return;
        }
        *rec = state::RecorderState::Transcribing;
    }
    events::state_changed(&app, state::RecorderState::Transcribing);
    if let Err(error) = supervise_transcription(transcribe_and_emit(app.clone(), s)).await {
        finish_transcription(&app, Err(error));
    }
}

/// COM-перечисление устройств и Core Audio ходят на blocking-пул: команда
/// синхронной была бы работой на главном потоке.
#[tauri::command]
#[specta::specta]
pub async fn list_audio_output_devices() -> Vec<capture::OutputDeviceInfo> {
    tokio::task::spawn_blocking(capture::list_output_devices)
        .await
        .unwrap_or_default()
}

#[cfg(test)]
mod tests;
