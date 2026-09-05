use crate::sync::LockUnpoisoned;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use ringbuf::traits::{Consumer, Observer, Producer, Split};
use ringbuf::{HeapCons, HeapProd, HeapRb};

use crate::audio;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "macos")]
use macos as backend;
#[cfg(target_os = "windows")]
use windows as backend;

const RING_SECONDS: usize = 8;
const CONSUMER_THREAD_NAME: &str = "audio-consumer";
const RAW_SCRATCH_CAPACITY: usize = 32 * 1024;
const MONO_SCRATCH_CAPACITY: usize = 16 * 1024;
const READ_BUF_SAMPLES: usize = 16 * 1024;
const OUT_PREALLOC_SECONDS: usize = 30;
/// Пауза консьюмера, когда идёт сессия: от неё зависит, как быстро чанк
/// доедет до стримингового sink'а.
const CONSUMER_IDLE_SLEEP: Duration = Duration::from_millis(5);
/// Пауза консьюмера в чистой буферизации (без сессии): латентность там не
/// нужна, а пятимиллисекундный опрос давал сотни пробуждений в секунду в простое.
const BUFFERING_IDLE_SLEEP: Duration = Duration::from_millis(20);
const STOP_WAIT_TIMEOUT: Duration = Duration::from_secs(5);
const SHUTDOWN_RESULT: &str = "захват остановлен";

#[derive(Debug, thiserror::Error)]
pub enum CaptureError {
    #[error("Нет разрешения на запись системного звука")]
    PermissionDenied,
    #[error("{0}")]
    Backend(String),
    #[error("Обработка аудио: {0}")]
    Audio(String),
}

impl crate::error::CodedError for CaptureError {
    fn code(&self) -> crate::error::ErrorCode {
        use crate::error::ErrorCode;
        match self {
            CaptureError::PermissionDenied => ErrorCode::Permission,
            CaptureError::Backend(_) | CaptureError::Audio(_) => ErrorCode::Internal,
        }
    }
}

pub type ChunkSink = Box<dyn FnMut(&[f32]) + Send>;
pub type DeviceChangeHandler = Box<dyn Fn() + Send + Sync>;

pub struct StreamSpec {
    pub sample_rate: u32,
    pub channels: usize,
}

enum Session {
    Idle,
    Start(Option<ChunkSink>),
    Running,
    Done(Result<Vec<f32>, String>),
}

struct Shared {
    recording: AtomicBool,
    buffering: AtomicBool,
    stop_requested: AtomicBool,
    /// Консьюмер обязан выйти: капчер дропается. Единственный сигнал, по
    /// которому его тред завершается, — без него каждая пересборка капчера
    /// (смена устройства, «Выдать», смена `capture_device_uid`) оставляла
    /// тред крутиться навечно вместе с кольцом на мегабайты.
    shutdown: AtomicBool,
    /// Бэкенд больше не подаёт сэмплы и сам это не починит (сменился формат
    /// устройства, консьюмер завис): фасад цел, но записывать им нельзя,
    /// `recording.rs` пересоздаёт капчер на следующем PTT.
    dead: AtomicBool,
    produced: AtomicU64,
    dropped: AtomicU64,
    sample_rate: u32,
    channels: usize,
    session: Mutex<Session>,
    rolling: Mutex<audio::RollingBuffer>,
    cv: Condvar,
}

impl Shared {
    fn shutting_down(&self) -> bool {
        self.shutdown.load(Ordering::Acquire)
    }

    /// Этим капчером больше нельзя записывать — лечится только пересозданием.
    fn mark_dead(&self) {
        self.dead.store(true, Ordering::Release);
    }
}

pub struct CallbackCtx {
    shared: Arc<Shared>,
    prod: HeapProd<f32>,
}

impl CallbackCtx {
    fn wants_samples(&self) -> bool {
        self.shared.recording.load(Ordering::Acquire)
            || self.shared.buffering.load(Ordering::Acquire)
    }

    /// Единственный вход в кольцо. Кладёт только ЦЕЛЫЕ кадры: частичная
    /// запись при переполнении сдвигала бы раскладку каналов до конца сессии
    /// (левый канал следующего кадра вставал на место правого), а `dropped`
    /// считается в сэмплах, как и `produced`.
    fn push_samples(&mut self, samples: &[f32]) {
        let channels = self.shared.channels.max(1);
        let room = self.prod.vacant_len();
        let whole = samples.len().min(room) / channels * channels;
        let pushed = self.prod.push_slice(&samples[..whole]);
        self.shared.produced.fetch_add(pushed as u64, Ordering::Relaxed);
        if pushed < samples.len() {
            self.shared
                .dropped
                .fetch_add((samples.len() - pushed) as u64, Ordering::Relaxed);
        }
    }

    /// Бэкенд рапортует, что источник умер окончательно.
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    fn mark_dead(&self) {
        self.shared.mark_dead();
    }
}

pub struct SystemAudioCapture {
    shared: Arc<Shared>,
    consumer: Option<std::thread::JoinHandle<()>>,
    /// `Option` только ради порядка в `Drop`: продюсер глушится ПЕРВЫМ, до
    /// остановки консьюмера, чтобы в кольцо не писали в пустоту.
    running: Option<backend::Running>,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct OutputDeviceInfo {
    pub uid: String,
    pub name: String,
}

pub fn list_output_devices() -> Vec<OutputDeviceInfo> {
    backend::list_output_devices()
}

pub fn watch_default_output_device(on_change: DeviceChangeHandler) {
    backend::watch_default_output_device(on_change);
}

impl SystemAudioCapture {
    pub fn new(output_device_uid: Option<&str>, buffer_secs: u64) -> Result<Self, CaptureError> {
        let (source, spec) = backend::open(output_device_uid)?;
        let (mut capture, ctx) = Self::assemble(spec, buffer_secs)?;
        match backend::start(source, ctx) {
            Ok(running) => {
                capture.running = Some(running);
                Ok(capture)
            }
            Err(e) => {
                // Иначе консьюмер, запущенный до бэкенда, пережил бы ошибку старта.
                capture.shutdown_consumer();
                Err(e)
            }
        }
    }

    /// Переносимая половина конструктора: кольцо, общее состояние и консьюмер
    /// без единого вызова в бэкенд. Отдельно от `new`, чтобы протокол сессии
    /// тестировался фейковым продюсером, без Core Audio и WASAPI.
    fn assemble(spec: StreamSpec, buffer_secs: u64) -> Result<(Self, Box<CallbackCtx>), CaptureError> {
        if spec.channels == 0 || spec.sample_rate == 0 {
            return Err(CaptureError::Backend("устройство вывода без каналов или частоты".into()));
        }
        let ring = HeapRb::<f32>::new(spec.sample_rate as usize * spec.channels * RING_SECONDS);
        let (prod, cons) = ring.split();
        let shared = Arc::new(Shared {
            recording: AtomicBool::new(false),
            buffering: AtomicBool::new(false),
            stop_requested: AtomicBool::new(false),
            shutdown: AtomicBool::new(false),
            dead: AtomicBool::new(false),
            produced: AtomicU64::new(0),
            dropped: AtomicU64::new(0),
            sample_rate: spec.sample_rate,
            channels: spec.channels,
            session: Mutex::new(Session::Idle),
            rolling: Mutex::new(audio::RollingBuffer::new(buffer_secs)),
            cv: Condvar::new(),
        });
        let ctx = Box::new(CallbackCtx {
            shared: Arc::clone(&shared),
            prod,
        });
        let consumer = {
            let shared = Arc::clone(&shared);
            std::thread::Builder::new()
                .name(CONSUMER_THREAD_NAME.into())
                .spawn(move || consumer_main(&shared, cons))
                .map_err(|e| CaptureError::Audio(e.to_string()))?
        };
        Ok((Self { shared, consumer: Some(consumer), running: None }, ctx))
    }

    fn shutdown_consumer(&mut self) {
        self.shared.shutdown.store(true, Ordering::Release);
        {
            let _wake = self.shared.session.lock_unpoisoned();
            self.shared.cv.notify_all();
        }
        if let Some(consumer) = self.consumer.take() {
            let _ = consumer.join();
        }
    }

    /// Запись можно начать только из покоя: `Start` поверх незавершённой
    /// сессии перезаписал бы её sink, а `Done` предыдущей записи потом
    /// вернулся бы в новую — звуком прошлого раза.
    pub fn start(&mut self, sink: Option<ChunkSink>) -> Result<(), CaptureError> {
        if self.is_dead() {
            return Err(CaptureError::Backend("захват мёртв — пересоздаётся".into()));
        }
        let mut s = self.shared.session.lock_unpoisoned();
        match &*s {
            Session::Idle | Session::Done(_) => {}
            Session::Start(_) | Session::Running => {
                return Err(CaptureError::Audio("предыдущая запись ещё не остановлена".into()));
            }
        }
        self.shared.stop_requested.store(false, Ordering::Release);
        *s = Session::Start(sink);
        self.shared.cv.notify_all();
        Ok(())
    }

    pub fn stop(&mut self) -> Result<Vec<f32>, CaptureError> {
        self.shared.stop_requested.store(true, Ordering::Release);
        let mut s = self.shared.session.lock_unpoisoned();
        loop {
            match &mut *s {
                Session::Done(res) => {
                    let res = std::mem::replace(res, Ok(Vec::new()));
                    *s = Session::Idle;
                    return res.map_err(CaptureError::Audio);
                }
                Session::Idle => return Ok(Vec::new()),
                _ => {
                    let (guard, timeout) = self
                        .shared
                        .cv
                        .wait_timeout(s, STOP_WAIT_TIMEOUT)
                        .unwrap();
                    s = guard;
                    if timeout.timed_out() {
                        // Консьюмер не отвечает — этим капчером больше не
                        // записать, и следующий PTT обязан его пересоздать.
                        self.shared.mark_dead();
                        return Err(CaptureError::Audio(format!(
                            "консьюмер не завершил запись за {}с",
                            STOP_WAIT_TIMEOUT.as_secs()
                        )));
                    }
                }
            }
        }
    }

    /// Капчером больше нельзя записывать: бэкенд отказал окончательно или
    /// консьюмер перестал отвечать. Лечится только пересозданием.
    pub fn is_dead(&self) -> bool {
        self.shared.dead.load(Ordering::Acquire)
    }

    pub fn recording_secs(&self) -> f32 {
        let samples = self.shared.produced.load(Ordering::Relaxed);
        let frames = samples / self.shared.channels.max(1) as u64;
        frames as f32 / self.shared.sample_rate.max(1) as f32
    }

    pub fn set_buffering(&self, enabled: bool) {
        self.shared.buffering.store(enabled, Ordering::Release);
        if enabled {
            let _wake = self.shared.session.lock_unpoisoned();
            self.shared.cv.notify_all();
        } else {
            self.shared.rolling.lock_unpoisoned().clear();
        }
    }

    pub fn set_buffer_capacity_secs(&self, secs: u64) {
        self.shared.rolling.lock_unpoisoned().set_capacity_secs(secs);
    }
}

/// Порядок обязателен: сначала глушится продюсер (`Running`), потом
/// консьюмеру велят выйти и его ДЖОЙНЯТ — тред, кольцо и rolling-буфер
/// освобождаются здесь, а не «когда-нибудь». Join безопасен: консьюмер не
/// берёт ни одного лока за пределами фасада.
impl Drop for SystemAudioCapture {
    fn drop(&mut self) {
        self.running = None;
        self.shutdown_consumer();
    }
}

struct Scratch {
    raw: Vec<f32>,
    mono: Vec<f32>,
    read_buf: Vec<f32>,
}

impl Scratch {
    fn new() -> Self {
        Self {
            raw: Vec::with_capacity(RAW_SCRATCH_CAPACITY),
            mono: Vec::with_capacity(MONO_SCRATCH_CAPACITY),
            read_buf: vec![0f32; READ_BUF_SAMPLES],
        }
    }
}

enum ConsumerWork {
    Session(Option<ChunkSink>),
    Buffering,
    Shutdown,
}

fn wait_for_work(shared: &Shared) -> ConsumerWork {
    let mut s = shared.session.lock_unpoisoned();
    loop {
        if shared.shutting_down() {
            return ConsumerWork::Shutdown;
        }
        if let Session::Start(sink) = &mut *s {
            let sink = sink.take();
            *s = Session::Running;
            return ConsumerWork::Session(sink);
        }
        if shared.buffering.load(Ordering::Acquire) {
            return ConsumerWork::Buffering;
        }
        s = shared.cv.wait(s).unwrap();
    }
}

fn consumer_main(shared: &Shared, mut ring: HeapCons<f32>) {
    let mut scratch = Scratch::new();
    loop {
        match wait_for_work(shared) {
            ConsumerWork::Session(sink) => run_ptt_session(shared, &mut ring, &mut scratch, sink),
            ConsumerWork::Buffering => run_buffering(shared, &mut ring, &mut scratch),
            ConsumerWork::Shutdown => return,
        }
    }
}

fn drain_ring_chunk(
    shared: &Shared,
    ring: &mut HeapCons<f32>,
    scratch: &mut Scratch,
) -> usize {
    let n = ring.pop_slice(&mut scratch.read_buf);
    if n == 0 {
        return 0;
    }
    scratch.raw.extend_from_slice(&scratch.read_buf[..n]);
    let whole = scratch.raw.len() - scratch.raw.len() % shared.channels.max(1);
    scratch.mono.clear();
    audio::downmix_into(&scratch.raw[..whole], shared.channels, &mut scratch.mono);
    scratch.raw.drain(..whole);
    n
}

/// Завершение сессии по единому протоколу: sink дропается (EOF стрима),
/// переполнение кольца попадает в stderr, результат кладётся в `Done` и
/// ожидающий `stop()` будится. Один код-путь на обе сессии (обычную и
/// буферную), чтобы протокол `recording` нельзя было сломать в одной из копий.
fn publish_session_result(shared: &Shared, sink: Option<ChunkSink>, result: Result<Vec<f32>, String>) {
    shared.recording.store(false, Ordering::Release);
    drop(sink);
    let dropped = shared.dropped.load(Ordering::Relaxed);
    if dropped > 0 {
        eprintln!("[perf] капчер: кольцо переполнялось, потеряно {dropped} сэмплов");
    }
    let mut s = shared.session.lock_unpoisoned();
    *s = Session::Done(result);
    shared.cv.notify_all();
}

fn run_ptt_session(
    shared: &Shared,
    ring: &mut HeapCons<f32>,
    scratch: &mut Scratch,
    mut sink: Option<ChunkSink>,
) {
    while ring.pop_slice(&mut scratch.read_buf) > 0 {}
    scratch.raw.clear();
    shared.produced.store(0, Ordering::Relaxed);
    shared.dropped.store(0, Ordering::Relaxed);

    let mut resampler = audio::StreamResampler::new(shared.sample_rate);
    let mut out: Vec<f32> =
        Vec::with_capacity(audio::TARGET_SAMPLE_RATE as usize * OUT_PREALLOC_SECONDS);
    let mut failure: Option<String> = None;

    shared.recording.store(true, Ordering::Release);

    loop {
        if shared.shutting_down() {
            return publish_session_result(shared, sink, Err(SHUTDOWN_RESULT.into()));
        }
        let stopping = shared.stop_requested.load(Ordering::Acquire);
        if stopping {
            shared.recording.store(false, Ordering::Release);
        }
        let n = drain_ring_chunk(shared, ring, scratch);
        if n > 0 {
            if failure.is_none() {
                let before = out.len();
                match &mut resampler {
                    Ok(rs) => {
                        if let Err(e) = rs.feed(&scratch.mono, &mut out) {
                            failure = Some(e.to_string());
                        }
                    }
                    Err(e) => failure = Some(e.to_string()),
                }
                forward_session_chunk(shared, &out[before..], &mut sink);
            }
            continue;
        }
        if stopping {
            break;
        }
        std::thread::sleep(CONSUMER_IDLE_SLEEP);
    }

    if failure.is_none() {
        let before = out.len();
        if let Ok(rs) = &mut resampler {
            if let Err(e) = rs.finish(&mut out) {
                failure = Some(e.to_string());
            }
        }
        forward_session_chunk(shared, &out[before..], &mut sink);
    }

    publish_session_result(
        shared,
        sink,
        match failure {
            None => Ok(out),
            Some(e) => Err(e),
        },
    );
}

fn forward_session_chunk(shared: &Shared, chunk: &[f32], sink: &mut Option<ChunkSink>) {
    if chunk.is_empty() {
        return;
    }
    if let Some(sink) = sink.as_mut() {
        sink(chunk);
    }
    if shared.buffering.load(Ordering::Acquire) {
        shared.rolling.lock_unpoisoned().push_chunk(chunk);
    }
}

struct BufferedSession {
    out: Vec<f32>,
    sink: Option<ChunkSink>,
}

/// Session- и rolling-локи никогда не держатся одновременно: снимок буфера
/// берётся уже после `drop(s)`.
fn take_pending_session(shared: &Shared) -> Option<BufferedSession> {
    let mut s = shared.session.lock_unpoisoned();
    let Session::Start(sink) = &mut *s else {
        return None;
    };
    let mut sink = sink.take();
    *s = Session::Running;
    drop(s);
    shared.produced.store(0, Ordering::Relaxed);
    shared.dropped.store(0, Ordering::Relaxed);
    shared.recording.store(true, Ordering::Release);
    let preroll = shared.rolling.lock_unpoisoned().snapshot();
    let mut out = Vec::with_capacity(
        preroll.len() + audio::TARGET_SAMPLE_RATE as usize * OUT_PREALLOC_SECONDS,
    );
    out.extend_from_slice(&preroll);
    if !preroll.is_empty() {
        if let Some(sink) = sink.as_mut() {
            sink(&preroll);
        }
    }
    Some(BufferedSession { out, sink })
}

fn finish_buffered_session(
    shared: &Shared,
    session: &mut Option<BufferedSession>,
    result: Result<(), String>,
) {
    shared.recording.store(false, Ordering::Release);
    let Some(sess) = session.take() else { return };
    publish_session_result(shared, sess.sink, result.map(|()| sess.out));
}

fn run_buffering(shared: &Shared, ring: &mut HeapCons<f32>, scratch: &mut Scratch) {
    let mut resampler = match audio::StreamResampler::new(shared.sample_rate) {
        Ok(rs) => rs,
        Err(e) => {
            eprintln!("фоновый буфер: ресемплер недоступен: {e}");
            shared.buffering.store(false, Ordering::Release);
            return;
        }
    };
    let mut chunk: Vec<f32> = Vec::with_capacity(MONO_SCRATCH_CAPACITY);
    let mut session: Option<BufferedSession> = None;

    loop {
        if shared.shutting_down() {
            finish_buffered_session(shared, &mut session, Err(SHUTDOWN_RESULT.into()));
            shared.rolling.lock_unpoisoned().clear();
            return;
        }
        if session.is_none() {
            if !shared.buffering.load(Ordering::Acquire) {
                shared.rolling.lock_unpoisoned().clear();
                return;
            }
            session = take_pending_session(shared);
        }
        let stopping = session.is_some() && shared.stop_requested.load(Ordering::Acquire);
        if stopping {
            shared.recording.store(false, Ordering::Release);
        }
        let n = drain_ring_chunk(shared, ring, scratch);
        if n > 0 {
            chunk.clear();
            if let Err(e) = resampler.feed(&scratch.mono, &mut chunk) {
                eprintln!("фоновый буфер: ресемплинг упал: {e}");
                finish_buffered_session(shared, &mut session, Err(e.to_string()));
                shared.buffering.store(false, Ordering::Release);
                shared.rolling.lock_unpoisoned().clear();
                return;
            }
            if !chunk.is_empty() {
                if shared.buffering.load(Ordering::Acquire) {
                    shared.rolling.lock_unpoisoned().push_chunk(&chunk);
                }
                if let Some(sess) = session.as_mut() {
                    sess.out.extend_from_slice(&chunk);
                    if let Some(sink) = sess.sink.as_mut() {
                        sink(&chunk);
                    }
                }
            }
            continue;
        }
        if stopping {
            finish_buffered_session(shared, &mut session, Ok(()));
            continue;
        }
        std::thread::sleep(if session.is_some() { CONSUMER_IDLE_SLEEP } else { BUFFERING_IDLE_SLEEP });
    }
}

#[cfg(test)]
mod tests;
