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
    build_capture, current_settings, llm_provider, stt_engine, stt_keyterms, App, SttStream,
};
use crate::error::{AppError, ErrorCode};
use crate::{audio, capture, events, global_shortcuts, state, stt};

/// Платформенные тексты — одно значение на платформу, не ветка логики.
const ERR_NO_CAPTURE: (ErrorCode, &str) = if cfg!(target_os = "macos") {
    (
        ErrorCode::Permission,
        "Нет разрешения на запись системного звука",
    )
} else {
    (
        ErrorCode::Internal,
        "Захват системного звука недоступен — проверь устройство вывода в настройках",
    )
};

const ERR_NO_SPEECH: &str = "В записи не нашлось слов — нечего вставлять";
const ERR_TRANSCRIPTION_CRASHED: &str = "Расшифровка прервалась внутренней ошибкой";
const ERR_MICROPHONE_PERMISSION: &str = "Разрешите доступ к микрофону в настройках распознавания";

fn microphone_capture_error(error: capture::CaptureError) -> AppError {
    match error {
        capture::CaptureError::PermissionDenied => {
            AppError::new(ErrorCode::Permission, ERR_MICROPHONE_PERMISSION)
        }
        error => AppError::from(&error),
    }
}

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

mod transcription;
use transcription::{AudioSource, RecordedTrack};
pub use transcription::{RecordedAudio, TranscriptReady};

/// Owns the microphone only between press and release. The system capture
/// remains separate because it alone supports optional pre-roll.
pub struct RecordingSession {
    system: bool,
    microphone: Option<capture::AudioCapture>,
    streams: Vec<(AudioSource, SttStream)>,
    engine: Arc<dyn stt::SttEngine>,
    keyterms: Vec<String>,
    started: std::time::Instant,
}

impl Drop for RecordingSession {
    fn drop(&mut self) {
        for (_, stream) in &self.streams {
            stream.cancel.cancel();
        }
    }
}

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
    StopSession,
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
            let _ =
                tauri::async_runtime::spawn_blocking(move || handle_ptt_event(&app, event)).await;
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
        PttEvent::StopSession => stop_session(app),
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
    let follows_system_default = app
        .state::<App>()
        .settings
        .lock_unpoisoned()
        .capture_device_uid
        .is_empty();
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
    let (new_capture, error) = match build_capture(&current_settings(app)) {
        Ok(capture) => (capture, None),
        Err(error) => {
            eprintln!("захват системного звука недоступен: {error}");
            (None, Some(AppError::from(&error)))
        }
    };
    *st.capture_error.lock_unpoisoned() = error;
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
    st.capture
        .lock_unpoisoned()
        .as_ref()
        .is_some_and(capture::AudioCapture::is_dead)
}

pub fn on_ptt_pressed(app: &AppHandle) {
    let st = app.state::<App>();
    if !st.recording_enabled.load(Ordering::Acquire) {
        return;
    }
    let mut recorder = st.recorder.lock_unpoisoned();
    if *recorder != state::RecorderState::Idle {
        return;
    }
    let settings = current_settings(app);
    if !settings.capture_system_audio && !settings.capture_microphone {
        events::stt_error(
            app,
            AppError::new(ErrorCode::Internal, "Выберите источник звука в настройках"),
        );
        return;
    }
    if settings.capture_system_audio
        && (st.capture_rebuild_pending.swap(false, Ordering::SeqCst)
            || capture_is_dead(&st)
            || st.capture.lock_unpoisoned().is_none())
    {
        rebuild_capture_now(app);
    }
    let session = match start_session(app, &settings) {
        Ok(session) => session,
        Err(error) => {
            events::stt_error(app, error);
            return;
        }
    };
    *st.recording_session.lock_unpoisoned() = Some(session);
    *st.last_recording.lock_unpoisoned() = None;
    recorder.on(state::Event::PttPressed);
    drop(recorder);
    let generation = st.recording_gen.fetch_add(1, Ordering::SeqCst) + 1;
    global_shortcuts::register_cancel(app, &global_shortcuts::cancel_combo(app));
    events::state_changed(app, state::RecorderState::Recording);
    spawn_max_duration_watchdog(app.clone(), generation);
    warm_up_llm_for_upcoming_request(app);
}

fn start_session(
    app: &AppHandle,
    settings: &crate::settings::Settings,
) -> Result<RecordingSession, AppError> {
    let st = app.state::<App>();
    if settings.capture_system_audio && st.capture.lock_unpoisoned().is_none() {
        return Err(st
            .capture_error
            .lock_unpoisoned()
            .clone()
            .unwrap_or_else(|| AppError::new(ERR_NO_CAPTURE.0, ERR_NO_CAPTURE.1)));
    }
    let microphone = if settings.capture_microphone {
        if crate::permissions::microphone_state() != crate::permissions::PermissionState::Granted {
            return Err(AppError::new(
                ErrorCode::Permission,
                ERR_MICROPHONE_PERMISSION,
            ));
        }
        Some(
            capture::AudioCapture::microphone(
                (!settings.microphone_device_uid.is_empty())
                    .then_some(settings.microphone_device_uid.as_str()),
            )
            .map_err(microphone_capture_error)?,
        )
    } else {
        None
    };
    let mut session = RecordingSession {
        system: settings.capture_system_audio,
        microphone,
        streams: Vec::new(),
        engine: stt_engine(app),
        keyterms: stt_keyterms(app),
        started: std::time::Instant::now(),
    };
    if let Some(microphone) = &mut session.microphone {
        let (sink, stream) =
            start_streaming_transcription(Arc::clone(&session.engine), session.keyterms.clone());
        session.streams.push((AudioSource::Microphone, stream));
        microphone
            .start(Some(sink))
            .map_err(microphone_capture_error)?;
    }
    if session.system {
        let (sink, stream) =
            start_streaming_transcription(Arc::clone(&session.engine), session.keyterms.clone());
        session.streams.push((AudioSource::System, stream));
        if let Some(capture) = st.capture.lock_unpoisoned().as_mut() {
            capture.start(Some(sink)).map_err(|e| AppError::from(&e))?;
        }
    }
    Ok(session)
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
        self.pending
            .extend_from_slice(&audio::f32_to_i16le_bytes(samples));
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

fn start_streaming_transcription(
    stt_client: Arc<dyn stt::SttEngine>,
    keyterms: Vec<String>,
) -> (capture::ChunkSink, SttStream) {
    let cancel = CancellationToken::new();
    let broken = Arc::new(AtomicBool::new(false));
    let (tx, rx) = tokio::sync::mpsc::channel::<SttBodyChunk>(STT_STREAM_CHANNEL_CAPACITY);
    let body_stream: stt::AudioChunkStream =
        Box::pin(futures_util::stream::unfold(rx, |mut rx| async move {
            rx.recv().await.map(|item| (item, rx))
        }));
    let handle = {
        let cancel = cancel.clone();
        tauri::async_runtime::spawn(async move {
            stt_client
                .transcribe_stream(body_stream, &keyterms, cancel)
                .await
        })
    };
    let stream = SttStream {
        handle,
        cancel,
        broken: Arc::clone(&broken),
    };
    let mut coalescer = ChunkCoalescer {
        pending: Vec::with_capacity(STT_CHUNK_TARGET_BYTES * 2),
        tx,
        broken,
    };
    (
        Box::new(move |samples: &[f32]| coalescer.push(samples)),
        stream,
    )
}

fn warm_up_llm_for_upcoming_request(app: &AppHandle) {
    let llm_client = llm_provider(app);
    tauri::async_runtime::spawn(async move { llm_client.warm_up().await });
}

fn current_recording_secs(st: &App) -> f32 {
    st.recording_session
        .lock_unpoisoned()
        .as_ref()
        .map_or(0.0, |s| s.started.elapsed().as_secs_f32())
}

fn stop_capture_discarding(st: &App) {
    let mut session = st.recording_session.lock_unpoisoned().take();
    if let Some(session) = &mut session {
        for (_, stream) in &session.streams {
            stream.cancel.cancel();
        }
        // Close hardware before waiting for the system consumer to drain.
        drop(session.microphone.take());
    }
    if session.as_ref().is_some_and(|s| s.system) {
        if let Some(capture) = st.capture.lock_unpoisoned().as_mut() {
            let _ = capture.stop();
        }
    }
    // Drop cancels each network request and closes the microphone device.
    drop(session);
}

pub fn on_ptt_released(app: &AppHandle) {
    let st = app.state::<App>();
    let secs = current_recording_secs(&st);
    let action = st.recorder.lock_unpoisoned().on(state::Event::PttReleased {
        duration_secs: secs,
    });
    global_shortcuts::unregister_cancel(app, &global_shortcuts::cancel_combo(app));
    finish_recording(app, action);
}

pub fn on_cancel(app: &AppHandle) {
    let st = app.state::<App>();
    let action = st.recorder.lock_unpoisoned().on(state::Event::Cancel);
    if action == state::Action::Discard {
        stop_capture_discarding(&st);
        global_shortcuts::unregister_cancel(app, &global_shortcuts::cancel_combo(app));
        events::state_changed(app, state::RecorderState::Idle);
    }
}

/// Called on the PTT worker, so a close cannot race a half-open microphone.
fn stop_session(app: &AppHandle) {
    let st = app.state::<App>();
    let mut recorder = st.recorder.lock_unpoisoned();
    if let Some(cancel) = st.transcription_cancel.lock_unpoisoned().take() {
        cancel.cancel();
    }
    stop_capture_discarding(&st);
    *st.last_recording.lock_unpoisoned() = None;
    st.recording_gen.fetch_add(1, Ordering::SeqCst);
    *recorder = state::RecorderState::Idle;
    events::state_changed(app, state::RecorderState::Idle);
}

pub fn stop_for_launcher(app: &AppHandle) {
    let st = app.state::<App>();
    st.recording_enabled.store(false, Ordering::Release);
    if let Some(cancel) = st.transcription_cancel.lock_unpoisoned().as_ref() {
        cancel.cancel();
    }
    enqueue_ptt(app, PttEvent::StopSession);
}

fn register_transcription(st: &App) -> CancellationToken {
    let cancel = CancellationToken::new();
    if let Some(old) = st
        .transcription_cancel
        .lock_unpoisoned()
        .replace(cancel.clone())
    {
        old.cancel();
    }
    cancel
}

fn on_max_duration_reached(app: &AppHandle, generation: u64) {
    let st = app.state::<App>();
    if st.recording_gen.load(Ordering::SeqCst) != generation {
        return;
    }
    let action = st
        .recorder
        .lock_unpoisoned()
        .on(state::Event::MaxDurationReached);
    if action == state::Action::None {
        return;
    }
    global_shortcuts::unregister_cancel(app, &global_shortcuts::cancel_combo(app));
    finish_recording(app, action);
}

fn finish_recording(app: &AppHandle, action: state::Action) {
    match action {
        state::Action::Discard => {
            stop_capture_discarding(&app.state::<App>());
            events::state_changed(app, state::RecorderState::Idle);
        }
        state::Action::Transcribe => transcribe_recording(app),
        _ => {}
    }
}

fn transcribe_recording(app: &AppHandle) {
    events::state_changed(app, state::RecorderState::Transcribing);
    let st = app.state::<App>();
    let Some(mut session) = st.recording_session.lock_unpoisoned().take() else {
        return finish_transcription(
            app,
            Err(AppError::new(ErrorCode::Internal, "Нет активной записи")),
        );
    };
    // Signal both channels before waiting for either consumer's final drain.
    if session.system {
        if let Some(capture) = st.capture.lock_unpoisoned().as_ref() {
            capture.request_stop();
        }
    }
    if let Some(mic) = &session.microphone {
        mic.request_stop();
    }
    // Finalize and close the microphone first, even if system capture stalls.
    let microphone = session.microphone.take().map(capture::AudioCapture::finish);
    let mut tracks = Vec::new();
    let mut failure = None;
    if session.system {
        if let Some(capture) = st.capture.lock_unpoisoned().as_mut() {
            match capture.stop() {
                Ok(samples) => tracks.push(RecordedTrack::new(AudioSource::System, samples)),
                Err(e) => failure = Some(AppError::from(&e)),
            }
        }
    }
    if let Some(result) = microphone {
        match result {
            Ok(samples) => tracks.push(RecordedTrack::new(AudioSource::Microphone, samples)),
            Err(e) => failure = Some(microphone_capture_error(e)),
        }
    }
    if let Some(error) = failure {
        return finish_transcription(app, Err(error));
    }
    let recorded = Arc::new(RecordedAudio {
        tracks,
        separated: session
            .streams
            .iter()
            .any(|(source, _)| *source == AudioSource::Microphone),
        keyterms: session.keyterms.clone(),
    });
    *st.last_recording.lock_unpoisoned() = Some(Arc::clone(&recorded));
    let streams = std::mem::take(&mut session.streams);
    let engine = Arc::clone(&session.engine);
    let cancel = register_transcription(&st);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        run_transcription(app, recorded, engine, streams, cancel).await;
    });
}

async fn supervise_transcription<T>(
    task: impl std::future::Future<Output = T>,
) -> Result<T, AppError> {
    std::panic::AssertUnwindSafe(task)
        .catch_unwind()
        .await
        // Audio is retained, so the UI must offer retry for a provider crash.
        .map_err(|_| AppError::new(ErrorCode::Retryable, ERR_TRANSCRIPTION_CRASHED))
}

/// Dropping the job also cancels transport tasks whose JoinHandles would
/// otherwise detach during cancellation, fallback or a panic.
struct StreamCancellation(Vec<CancellationToken>);
impl Drop for StreamCancellation {
    fn drop(&mut self) {
        for token in &self.0 {
            token.cancel();
        }
    }
}

async fn run_transcription(
    app: AppHandle,
    recorded: Arc<RecordedAudio>,
    engine: Arc<dyn stt::SttEngine>,
    streams: Vec<(AudioSource, SttStream)>,
    cancel: CancellationToken,
) {
    let _streams = StreamCancellation(streams.iter().map(|(_, s)| s.cancel.clone()).collect());
    let outcome = tokio::select! {
        biased;
        () = cancel.cancelled() => return,
        result = supervise_transcription(recorded.recognize(engine, streams)) => result.and_then(std::convert::identity),
    };
    let st = app.state::<App>();
    let mut recorder = st.recorder.lock_unpoisoned();
    if cancel.is_cancelled() || !st.recording_enabled.load(Ordering::Acquire) {
        return;
    }
    st.transcription_cancel.lock_unpoisoned().take();
    *recorder = state::RecorderState::Idle;
    match outcome {
        Ok(transcript) => {
            // Retry is only meaningful after failure. Release both PCM tracks
            // after success and prevent a late retry from inserting them again.
            st.last_recording.lock_unpoisoned().take();
            events::transcript_ready(&app, transcript);
            events::focus_prompt(&app);
        }
        Err(error) => events::stt_error(&app, error),
    }
    events::state_changed(&app, state::RecorderState::Idle);
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
        Err(e @ (stt::SttError::BadApiKey(_) | stt::SttError::BadAccessCode(_))) => {
            StreamVerdict::Fail(e)
        }
        Err(_) => StreamVerdict::FallBack,
    }
}

async fn settle_stream(stream: SttStream) -> StreamVerdict {
    let SttStream {
        handle,
        cancel,
        broken,
    } = stream;
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
            eprintln!(
                "[perf] stt stream не ответил за {STREAM_FINISH_TIMEOUT:?} — фолбэк на классику"
            );
            cancel.cancel();
            StreamVerdict::FallBack
        }
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
    let st = app.state::<App>();
    let (recorded, cancel) = {
        let mut recorder = st.recorder.lock_unpoisoned();
        if *recorder != state::RecorderState::Idle || !st.recording_enabled.load(Ordering::Acquire)
        {
            return;
        }
        let Some(recorded) = st.last_recording.lock_unpoisoned().clone() else {
            return;
        };
        *recorder = state::RecorderState::Transcribing;
        (recorded, register_transcription(&st))
    };
    events::state_changed(&app, state::RecorderState::Transcribing);
    let engine = stt_engine(&app);
    run_transcription(app.clone(), recorded, engine, Vec::new(), cancel).await;
}

/// COM-перечисление устройств и Core Audio ходят на blocking-пул: команда
/// синхронной была бы работой на главном потоке.
#[tauri::command]
#[specta::specta]
pub async fn list_audio_devices() -> Result<capture::AudioDevices, AppError> {
    tokio::task::spawn_blocking(capture::list_devices)
        .await
        .map_err(|e| AppError::new(ErrorCode::Internal, e.to_string()))?
        .map_err(|e| AppError::from(&e))
}

#[cfg(test)]
mod tests;
