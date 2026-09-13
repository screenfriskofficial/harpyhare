use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;

use futures_util::StreamExt;
use tauri::{AppHandle, Manager};
use tokio_util::sync::CancellationToken;

use crate::app_state::{
    build_capture, build_microphone_capture, cancel_stt_stream, current_settings, llm_provider,
    stt_engine, stt_keyterms, App, SttStream,
};
use crate::error::{AppError, ErrorCode};
use crate::{audio, capture, events, hotkey, state, stt};

#[cfg(target_os = "macos")]
const ERR_NO_CAPTURE: (ErrorCode, &str) = (
    ErrorCode::Permission,
    "Нет разрешения на запись системного звука",
);
#[cfg(target_os = "windows")]
const ERR_NO_CAPTURE: (ErrorCode, &str) = (
    ErrorCode::Internal,
    "Захват системного звука недоступен — проверь устройство вывода в настройках",
);
const ERR_NO_AUDIO_BUFFER: &str = "нет аудио-буфера";
const ERR_NO_MICROPHONE: &str =
    "Микрофон недоступен — проверь устройство ввода и разрешение на микрофон";
const ERR_MICROPHONE_SILENCE: &str =
    "Тишина — нечего распознавать (проверь микрофон и разрешение на его использование)";
#[cfg(target_os = "macos")]
const ERR_SILENCE: &str = "Тишина — нечего распознавать (если звук играл: проверь право «Запись системного звука» у macOS и устройство захвата в настройках)";
#[cfg(target_os = "windows")]
const ERR_SILENCE: &str = "Тишина — нечего распознавать (если звук играл: проверь устройство вывода в настройках захвата)";

const STT_STREAM_CHANNEL_CAPACITY: usize = 256;
const MAX_DURATION_WATCHDOG_INTERVAL: Duration = Duration::from_secs(1);

type SttBodyChunk = Result<Vec<u8>, std::io::Error>;

pub fn install_default_output_device_listener(app: &AppHandle) {
    let app = app.clone();
    capture::watch_default_output_device(Box::new(move || {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            handle_default_output_device_changed(&app);
        });
    }));
}

fn handle_default_output_device_changed(app: &AppHandle) {
    let follows_system_default = app
        .state::<App>()
        .settings
        .lock()
        .unwrap()
        .capture_device_uid
        .is_empty();
    if follows_system_default {
        request_capture_rebuild(app);
    }
}

pub fn request_capture_rebuild(app: &AppHandle) {
    let st = app.state::<App>();
    let idle = *st.recorder.lock().unwrap() == state::RecorderState::Idle;
    if idle {
        rebuild_capture_now(app);
    } else {
        st.capture_rebuild_pending.store(true, Ordering::SeqCst);
    }
}

pub fn rebuild_capture(app: &AppHandle) -> bool {
    let st = app.state::<App>();
    let new_capture = build_capture(&current_settings(app));
    let built = new_capture.is_some();
    *st.capture.lock().unwrap() = new_capture;
    built
}

pub fn ensure_capture(app: &AppHandle) -> bool {
    if app.state::<App>().capture.lock().unwrap().is_some() {
        return true;
    }
    rebuild_capture(app)
}

fn ensure_microphone_capture(app: &AppHandle) -> bool {
    let st = app.state::<App>();
    if st.microphone_capture.lock().unwrap().is_some() {
        return true;
    }
    let capture = build_microphone_capture(&current_settings(app));
    let built = capture.is_some();
    *st.microphone_capture.lock().unwrap() = capture;
    built
}

fn rebuild_capture_now(app: &AppHandle) {
    let never_built = app.state::<App>().capture.lock().unwrap().is_none();
    let would_prompt = crate::permissions::AUDIO_REQUIRES_PERMISSION
        && !current_settings(app).audio_permission_requested;
    if never_built && would_prompt {
        return;
    }
    rebuild_capture(app);
}

pub fn on_system_ptt_pressed(app: &AppHandle) {
    on_ptt_pressed(app, state::RecordingSource::System);
}

pub fn on_microphone_ptt_pressed(app: &AppHandle) {
    on_ptt_pressed(app, state::RecordingSource::Microphone);
}

fn on_ptt_pressed(app: &AppHandle, source: state::RecordingSource) {
    let st = app.state::<App>();
    // Reserve the session before opening either device. A second hotkey must
    // not open a microphone (or rebuild the system capture) during another session.
    let action = st.recorder.lock().unwrap().on(state::Event::PttPressed);
    if action != state::Action::StartCapture {
        return;
    }
    if source == state::RecordingSource::System
        && st.capture_rebuild_pending.swap(false, Ordering::SeqCst)
    {
        rebuild_capture_now(app);
    }
    let available = match source {
        state::RecordingSource::System => ensure_capture(app),
        state::RecordingSource::Microphone => ensure_microphone_capture(app),
    };
    if !available {
        st.recorder.lock().unwrap().on(state::Event::Cancel);
        let message = match source {
            state::RecordingSource::System => ERR_NO_CAPTURE.1,
            state::RecordingSource::Microphone => ERR_NO_MICROPHONE,
        };
        events::stt_error(app, AppError::new(ERR_NO_CAPTURE.0, message));
        return;
    }
    *st.recording_source.lock().unwrap() = Some(source);
    let sink = start_streaming_transcription(app);
    let started = with_capture_mut(&st, source, |c| c.start(Some(sink))).unwrap_or_else(|| {
        Err(capture::CaptureError::Audio(
            ERR_NO_AUDIO_BUFFER.to_string(),
        ))
    });
    if let Err(e) = started {
        st.microphone_capture.lock().unwrap().take();
        cancel_stt_stream(app);
        events::stt_error(app, AppError::from(&e));
        st.recorder.lock().unwrap().on(state::Event::Cancel);
        *st.recording_source.lock().unwrap() = None;
        return;
    }
    let gen = st.recording_gen.fetch_add(1, Ordering::SeqCst) + 1;
    hotkey::register_cancel(app, &hotkey::cancel_combo(app));
    events::state_changed(app, state::RecorderState::Recording);
    spawn_max_duration_watchdog(app.clone(), gen);
    warm_up_llm_for_upcoming_request(app);
}

fn start_streaming_transcription(app: &AppHandle) -> capture::ChunkSink {
    let st = app.state::<App>();
    let stt_client = stt_engine(app);
    let keyterms = stt_keyterms(app);
    let cancel = CancellationToken::new();
    let broken = Arc::new(AtomicBool::new(false));
    let (tx, rx) = tokio::sync::mpsc::channel::<SttBodyChunk>(STT_STREAM_CHANNEL_CAPACITY);
    let header: SttBodyChunk = Ok(audio::wav_header_streaming().to_vec());
    let body_stream: stt::AudioChunkStream = Box::pin(futures_util::stream::iter([header]).chain(
        futures_util::stream::unfold(rx, |mut rx| async move {
            rx.recv().await.map(|item| (item, rx))
        }),
    ));
    let handle = {
        let cancel = cancel.clone();
        tauri::async_runtime::spawn(async move {
            stt_client
                .transcribe_stream(body_stream, &keyterms, cancel)
                .await
        })
    };
    if let Some(old) = st.stt_stream.lock().unwrap().replace(SttStream {
        handle,
        cancel,
        broken: Arc::clone(&broken),
    }) {
        old.cancel.cancel();
    }
    Box::new(move |samples: &[f32]| {
        if broken.load(Ordering::Relaxed) {
            return;
        }
        if tx.try_send(Ok(audio::f32_to_i16le_bytes(samples))).is_err() {
            broken.store(true, Ordering::Relaxed);
        }
    })
}

fn warm_up_llm_for_upcoming_request(app: &AppHandle) {
    let llm_client = llm_provider(app);
    tauri::async_runtime::spawn(async move { llm_client.warm_up().await });
}

fn with_capture_mut<T>(
    st: &App,
    source: state::RecordingSource,
    work: impl FnOnce(&mut capture::SystemAudioCapture) -> T,
) -> Option<T> {
    match source {
        state::RecordingSource::System => st.capture.lock().unwrap().as_mut().map(work),
        state::RecordingSource::Microphone => {
            st.microphone_capture.lock().unwrap().as_mut().map(work)
        }
    }
}

fn active_source(st: &App) -> Option<state::RecordingSource> {
    *st.recording_source.lock().unwrap()
}

fn current_recording_secs(st: &App) -> f32 {
    active_source(st)
        .and_then(|source| with_capture_mut(st, source, |c| c.recording_secs()))
        .unwrap_or(0.0)
}

fn stop_capture_discarding(st: &App) {
    if let Some(source) = active_source(st) {
        let _ = stop_capture(st, source);
    }
}

fn stop_capture(
    st: &App,
    source: state::RecordingSource,
) -> Option<Result<Vec<f32>, capture::CaptureError>> {
    match source {
        state::RecordingSource::System => with_capture_mut(st, source, |c| c.stop()),
        // Release the native stream on stop, discard and error. The next PTT
        // resolves the saved UID (or the current default) anew, without preroll.
        state::RecordingSource::Microphone => st
            .microphone_capture
            .lock()
            .unwrap()
            .take()
            .map(|mut c| c.stop()),
    }
}

pub fn on_system_ptt_released(app: &AppHandle) {
    on_ptt_released(app, state::RecordingSource::System);
}

pub fn on_microphone_ptt_released(app: &AppHandle) {
    on_ptt_released(app, state::RecordingSource::Microphone);
}

fn on_ptt_released(app: &AppHandle, source: state::RecordingSource) {
    let st = app.state::<App>();
    if active_source(&st) != Some(source) {
        return;
    }
    let secs = current_recording_secs(&st);
    let action = st.recorder.lock().unwrap().on(state::Event::PttReleased {
        duration_secs: secs,
    });
    hotkey::unregister_cancel(app, &hotkey::cancel_combo(app));
    finish_recording(app, action);
}

pub fn on_cancel(app: &AppHandle) {
    let st = app.state::<App>();
    let action = st.recorder.lock().unwrap().on(state::Event::Cancel);
    if action == state::Action::Discard {
        cancel_stt_stream(app);
        stop_capture_discarding(&st);
        hotkey::unregister_cancel(app, &hotkey::cancel_combo(app));
        events::state_changed(app, state::RecorderState::Idle);
        *st.recording_source.lock().unwrap() = None;
    }
}

fn finish_recording(app: &AppHandle, action: state::Action) {
    match action {
        state::Action::Discard => {
            cancel_stt_stream(app);
            stop_capture_discarding(&app.state::<App>());
            events::state_changed(app, state::RecorderState::Idle);
            *app.state::<App>().recording_source.lock().unwrap() = None;
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
        let message = match active_source(&app.state::<App>()) {
            Some(state::RecordingSource::Microphone) => ERR_MICROPHONE_SILENCE,
            _ => ERR_SILENCE,
        };
        cancel_stt_stream(app);
        return finish_transcription(app, Err(AppError::new(ErrorCode::Silence, message)));
    }
    *app.state::<App>().last_recording.lock().unwrap() = Some(s16k.clone());
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move { finish_transcribe(app2, s16k).await });
}

fn stop_capture_for_transcription(app: &AppHandle) -> Result<Vec<f32>, AppError> {
    let t = std::time::Instant::now();
    let st = app.state::<App>();
    let stopped = active_source(&st).and_then(|source| stop_capture(&st, source));
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

async fn finish_transcribe(app: AppHandle, samples: Vec<f32>) {
    let t = std::time::Instant::now();
    let stream = app.state::<App>().stt_stream.lock().unwrap().take();
    if let Some(s) = stream {
        if s.broken.load(Ordering::Relaxed) {
            eprintln!("[perf] stt stream неполон — фолбэк на классическую загрузку");
            s.cancel.cancel();
        } else {
            match s.handle.await {
                Ok(Ok(text)) => {
                    eprintln!("[perf] stop → transcript (stream) {:?}", t.elapsed());
                    return deliver_transcript(&app, text);
                }
                Ok(Err(e @ (stt::SttError::BadApiKey(_) | stt::SttError::BadAccessCode(_)))) => {
                    return finish_transcription(&app, Err(AppError::from(&e)));
                }
                Ok(Err(e)) => {
                    eprintln!("[perf] stt stream не удался ({e}) — фолбэк на классику");
                }
                Err(e) => {
                    eprintln!("[perf] stt stream задача упала ({e}) — фолбэк на классику");
                }
            }
        }
    }
    transcribe_and_emit(app, samples).await;
}

fn deliver_transcript(app: &AppHandle, text: String) {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let _ = app.clipboard().write_text(text.clone());
    events::transcript_ready(app, text);
    events::focus_prompt(app);
    finish_transcription(app, Ok(()));
}

async fn transcribe_and_emit(app: AppHandle, samples: Vec<f32>) {
    let stt_client = stt_engine(&app);
    let keyterms = stt_keyterms(&app);
    let settings = current_settings(&app);
    let trace = crate::diagnostics::Trace::new(
        crate::diagnostics::DiagnosticKind::Transcription,
        crate::diagnostics::DiagnosticOrigin::Session,
        &settings.stt_provider,
        "",
    );
    let t = std::time::Instant::now();
    let res = trace
        .scope(stt_client.transcribe(&samples, &keyterms))
        .await;
    eprintln!(
        "[perf] stt transcribe (wav+upload+inference) {:?}",
        t.elapsed()
    );
    trace.finish(res.as_ref().err().map(crate::error::CodedError::code));
    match res {
        Ok(text) => deliver_transcript(&app, text),
        Err(e) => finish_transcription(&app, Err(AppError::from(&e))),
    }
}

fn finish_transcription(app: &AppHandle, result: Result<(), AppError>) {
    let st = app.state::<App>();
    st.recorder
        .lock()
        .unwrap()
        .on(state::Event::TranscriptionFinished);
    if let Err(err) = result {
        events::stt_error(app, err);
    }
    *st.recording_source.lock().unwrap() = None;
    events::state_changed(app, state::RecorderState::Idle);
}

fn spawn_max_duration_watchdog(app: AppHandle, my_gen: u64) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(MAX_DURATION_WATCHDOG_INTERVAL).await;
            let st = app.state::<App>();
            if st.recording_gen.load(Ordering::SeqCst) != my_gen {
                break;
            }
            if *st.recorder.lock().unwrap() != state::RecorderState::Recording {
                break;
            }
            if current_recording_secs(&st) >= state::MAX_RECORDING_SECS {
                let action = st
                    .recorder
                    .lock()
                    .unwrap()
                    .on(state::Event::MaxDurationReached);
                hotkey::unregister_cancel(&app, &hotkey::cancel_combo(&app));
                finish_recording(&app, action);
                break;
            }
        }
    });
}

#[tauri::command]
#[specta::specta]
pub async fn retry_transcription(app: AppHandle) {
    let samples = app.state::<App>().last_recording.lock().unwrap().clone();
    let Some(s) = samples else { return };
    {
        let st = app.state::<App>();
        let mut rec = st.recorder.lock().unwrap();
        if *rec != state::RecorderState::Idle {
            return;
        }
        *rec = state::RecorderState::Transcribing;
    }
    events::state_changed(&app, state::RecorderState::Transcribing);
    transcribe_and_emit(app, s).await;
}

#[tauri::command]
#[specta::specta]
pub fn list_audio_output_devices() -> Vec<capture::AudioDeviceInfo> {
    capture::list_output_devices()
}

#[tauri::command]
#[specta::specta]
pub fn list_audio_input_devices() -> Vec<capture::AudioDeviceInfo> {
    capture::list_input_devices()
}
