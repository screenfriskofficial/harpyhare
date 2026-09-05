use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use windows::core::PCWSTR;
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Foundation::{E_ACCESSDENIED, RPC_E_CHANGED_MODE};
use windows::Win32::Media::Audio::{
    eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDevice, IMMDeviceEnumerator,
    MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
    AUDCLNT_STREAMFLAGS_LOOPBACK, DEVICE_STATE_ACTIVE, WAVEFORMATEX, WAVEFORMATEXTENSIBLE,
};
use windows::Win32::Media::KernelStreaming::WAVE_FORMAT_EXTENSIBLE;
use windows::Win32::Media::Multimedia::{KSDATAFORMAT_SUBTYPE_IEEE_FLOAT, WAVE_FORMAT_IEEE_FLOAT};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
    COINIT_MULTITHREADED, STGM_READ,
};

use super::{CallbackCtx, CaptureError, DeviceChangeHandler, OutputDeviceInfo, StreamSpec};

const CAPTURE_THREAD_NAME: &str = "wasapi-loopback";
const DEVICE_WATCH_THREAD_NAME: &str = "wasapi-device-watch";
const DEVICE_POLL_INTERVAL: Duration = Duration::from_secs(2);
const REFERENCE_TIMES_PER_SECOND: i64 = 10_000_000;
const CLIENT_BUFFER_SECONDS: f64 = 1.0;
const START_TIMEOUT: Duration = Duration::from_secs(5);
const REOPEN_DELAY: Duration = Duration::from_secs(1);
const MIN_POLL_INTERVAL: Duration = Duration::from_millis(2);
const MAX_POLL_INTERVAL: Duration = Duration::from_millis(20);
/// Шаг, которым поток захвата пережидает `REOPEN_DELAY`, сверяясь с флагом
/// остановки: `Running::drop` джойнит поток, и секундный сон целиком держал бы
/// того, кто ждёт капчер.
const STOP_POLL_SLICE: Duration = Duration::from_millis(50);
/// Потолок тишины, которую `Timeline` дозаполняет за один опрос. Loopback не
/// отдаёт пакетов, пока никто не рендерит, и время без пакетов считается по
/// часам; без потолка десятиминутное отсутствие устройства превращалось в
/// аллокацию на сотни мегабайт в потоке захвата — в кольцо всё равно влезает
/// лишь несколько секунд.
const MAX_SILENCE_GAP: Duration = Duration::from_secs(1);
const BITS_PER_BYTE: u16 = 8;
const FLOAT_SAMPLE_BYTES: usize = 4;
const INT16_SAMPLE_BYTES: usize = 2;
const INT32_SAMPLE_BYTES: usize = 4;
const I16_SCALE: f32 = 32768.0;
const I32_SCALE: f32 = 2_147_483_648.0;

struct ComGuard {
    owns_apartment: bool,
}

impl ComGuard {
    fn enter() -> Result<Self, CaptureError> {
        let status = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        if status == RPC_E_CHANGED_MODE {
            return Ok(Self {
                owns_apartment: false,
            });
        }
        status.ok().map_err(backend_error)?;
        Ok(Self {
            owns_apartment: true,
        })
    }
}

impl Drop for ComGuard {
    fn drop(&mut self) {
        if self.owns_apartment {
            unsafe { CoUninitialize() };
        }
    }
}

fn backend_error(err: windows::core::Error) -> CaptureError {
    if err.code() == E_ACCESSDENIED {
        CaptureError::PermissionDenied
    } else {
        CaptureError::Backend(format!("WASAPI: {err}"))
    }
}

fn enumerator() -> Result<IMMDeviceEnumerator, CaptureError> {
    unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }.map_err(backend_error)
}

fn device_id(device: &IMMDevice) -> Result<String, CaptureError> {
    unsafe {
        let raw = device.GetId().map_err(backend_error)?;
        let text = raw.to_string();
        CoTaskMemFree(Some(raw.0 as *const _));
        text.map_err(|e| CaptureError::Backend(e.to_string()))
    }
}

fn device_name(device: &IMMDevice) -> Result<String, CaptureError> {
    unsafe {
        let store = device.OpenPropertyStore(STGM_READ).map_err(backend_error)?;
        let value = store
            .GetValue(&PKEY_Device_FriendlyName)
            .map_err(backend_error)?;
        Ok(value.to_string())
    }
}

fn collect_output_devices() -> Result<Vec<OutputDeviceInfo>, CaptureError> {
    let _com = ComGuard::enter()?;
    let devices = unsafe {
        enumerator()?
            .EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)
            .map_err(backend_error)?
    };
    let count = unsafe { devices.GetCount().map_err(backend_error)? };
    let mut out = Vec::with_capacity(count as usize);
    for index in 0..count {
        let device = unsafe { devices.Item(index).map_err(backend_error)? };
        out.push(OutputDeviceInfo {
            uid: device_id(&device)?,
            name: device_name(&device)?,
        });
    }
    Ok(out)
}

pub fn list_output_devices() -> Vec<OutputDeviceInfo> {
    match collect_output_devices() {
        Ok(devices) => devices,
        Err(e) => {
            eprintln!("список устройств вывода недоступен: {e}");
            Vec::new()
        }
    }
}

fn default_output_device(enumerator: &IMMDeviceEnumerator) -> Result<IMMDevice, CaptureError> {
    unsafe { enumerator.GetDefaultAudioEndpoint(eRender, eConsole) }.map_err(backend_error)
}

fn device_by_id(
    enumerator: &IMMDeviceEnumerator,
    device_id: &str,
) -> Result<IMMDevice, CaptureError> {
    let wide: Vec<u16> = device_id.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe { enumerator.GetDevice(PCWSTR(wide.as_ptr())) }.map_err(backend_error)
}

fn resolve_output_device(
    enumerator: &IMMDeviceEnumerator,
    uid: Option<&str>,
) -> Result<IMMDevice, CaptureError> {
    let Some(uid) = uid else {
        return default_output_device(enumerator);
    };
    match device_by_id(enumerator, uid) {
        Ok(device) => Ok(device),
        Err(_) => {
            eprintln!("устройство захвата {uid:?} не найдено — используется системный вывод");
            default_output_device(enumerator)
        }
    }
}

fn current_default_device_id(enumerator: &IMMDeviceEnumerator) -> Option<String> {
    device_id(&default_output_device(enumerator).ok()?).ok()
}

pub fn watch_default_output_device(on_change: DeviceChangeHandler) {
    let spawned = std::thread::Builder::new()
        .name(DEVICE_WATCH_THREAD_NAME.into())
        .spawn(move || {
            let Ok(_com) = ComGuard::enter() else {
                return;
            };
            let Ok(enumerator) = enumerator() else {
                return;
            };
            let mut current = current_default_device_id(&enumerator);
            loop {
                std::thread::sleep(DEVICE_POLL_INTERVAL);
                let Some(next) = current_default_device_id(&enumerator) else {
                    continue;
                };
                if current.as_deref() != Some(next.as_str()) {
                    let known = current.is_some();
                    current = Some(next);
                    if known {
                        on_change();
                    }
                }
            }
        });
    if let Err(e) = spawned {
        eprintln!("не удалось следить за сменой аудио-вывода: {e}");
    }
}

#[derive(Clone, Copy)]
struct SampleFormat {
    channels: usize,
    sample_rate: u32,
    is_float: bool,
    bytes_per_sample: usize,
}

impl SampleFormat {
    fn is_decodable(&self, bits_per_sample: u16) -> bool {
        if !bits_per_sample.is_multiple_of(BITS_PER_BYTE) {
            return false;
        }
        matches!(
            (self.is_float, self.bytes_per_sample),
            (true, FLOAT_SAMPLE_BYTES) | (false, INT16_SAMPLE_BYTES | INT32_SAMPLE_BYTES)
        )
    }

    fn spec(&self) -> StreamSpec {
        StreamSpec {
            sample_rate: self.sample_rate,
            channels: self.channels,
        }
    }

    fn matches(&self, spec: &StreamSpec) -> bool {
        self.sample_rate == spec.sample_rate && self.channels == spec.channels
    }
}

fn read_sample_format(mix: *const WAVEFORMATEX) -> (SampleFormat, u16) {
    let base = unsafe { std::ptr::read_unaligned(mix) };
    let is_float = if base.wFormatTag as u32 == WAVE_FORMAT_EXTENSIBLE {
        let extensible = mix as *const WAVEFORMATEXTENSIBLE;
        let sub_format = unsafe { std::ptr::addr_of!((*extensible).SubFormat).read_unaligned() };
        sub_format == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT
    } else {
        base.wFormatTag as u32 == WAVE_FORMAT_IEEE_FLOAT
    };
    let format = SampleFormat {
        channels: base.nChannels as usize,
        sample_rate: base.nSamplesPerSec,
        is_float,
        bytes_per_sample: (base.wBitsPerSample / BITS_PER_BYTE) as usize,
    };
    (format, base.wBitsPerSample)
}

struct MixFormat(*mut WAVEFORMATEX);

impl Drop for MixFormat {
    fn drop(&mut self) {
        unsafe { CoTaskMemFree(Some(self.0 as *const _)) };
    }
}

fn activate_client(device: &IMMDevice) -> Result<(IAudioClient, SampleFormat), CaptureError> {
    let client: IAudioClient =
        unsafe { device.Activate(CLSCTX_ALL, None) }.map_err(backend_error)?;
    let mix = MixFormat(unsafe { client.GetMixFormat() }.map_err(backend_error)?);
    let (format, bits_per_sample) = read_sample_format(mix.0);
    if !format.is_decodable(bits_per_sample) {
        return Err(CaptureError::Backend(format!(
            "неподдерживаемый формат устройства вывода: {bits_per_sample} бит, float={}",
            format.is_float
        )));
    }
    Ok((client, format))
}

pub struct Source {
    device_id: String,
}

pub struct Running {
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

/// Флаг и join: поток захвата держит COM-объекты устройства, и «когда-нибудь
/// сам выйдет» значило бы, что капчер, пересозданный после смены устройства,
/// какое-то время делит эндпоинт с ещё живым предшественником.
impl Drop for Running {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn sleep_unless_stopped(stop: &AtomicBool, total: Duration) {
    let started = Instant::now();
    while !stop.load(Ordering::Acquire) && started.elapsed() < total {
        std::thread::sleep(STOP_POLL_SLICE.min(total));
    }
}

pub fn open(output_device_uid: Option<&str>) -> Result<(Source, StreamSpec), CaptureError> {
    let _com = ComGuard::enter()?;
    let enumerator = enumerator()?;
    let device = resolve_output_device(&enumerator, output_device_uid)?;
    let source = Source {
        device_id: device_id(&device)?,
    };
    let (_client, format) = activate_client(&device)?;
    Ok((source, format.spec()))
}

pub fn start(source: Source, ctx: Box<CallbackCtx>) -> Result<Running, CaptureError> {
    let stop = Arc::new(AtomicBool::new(false));
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), CaptureError>>();
    let spec = StreamSpec {
        sample_rate: ctx.shared.sample_rate,
        channels: ctx.shared.channels,
    };
    let thread_stop = Arc::clone(&stop);
    let thread = std::thread::Builder::new()
        .name(CAPTURE_THREAD_NAME.into())
        .spawn(move || capture_main(source, ctx, spec, thread_stop, ready_tx))
        .map_err(|e| CaptureError::Audio(e.to_string()))?;

    let started = ready_rx.recv_timeout(START_TIMEOUT);
    if let Ok(Ok(())) = started {
        return Ok(Running { stop, thread: Some(thread) });
    }
    stop.store(true, Ordering::Release);
    let _ = thread.join();
    match started {
        Ok(Err(e)) => Err(e),
        _ => Err(CaptureError::Backend(
            "поток захвата не запустился".to_string(),
        )),
    }
}

/// Почему поток не смог переоткрыть loopback: пройдёт ли это само.
enum ReopenFailure {
    /// Устройство пропало или занято — через секунду может вернуться.
    Transient(CaptureError),
    /// Формат устройства изменился: с этим `StreamSpec` поток не откроется
    /// никогда, ретраить бессмысленно — капчер надо пересоздать.
    Fatal(CaptureError),
}

struct LoopbackStream {
    client: IAudioClient,
    capture: IAudioCaptureClient,
    format: SampleFormat,
    poll_interval: Duration,
}

impl Drop for LoopbackStream {
    fn drop(&mut self) {
        unsafe { self.client.Stop() }.ok();
    }
}

fn poll_interval(client: &IAudioClient) -> Duration {
    let mut default_period: i64 = 0;
    if unsafe { client.GetDevicePeriod(Some(&mut default_period), None) }.is_err() {
        return MAX_POLL_INTERVAL;
    }
    let nanos = (default_period as u64).saturating_mul(100) / 2;
    Duration::from_nanos(nanos).clamp(MIN_POLL_INTERVAL, MAX_POLL_INTERVAL)
}

fn open_stream(device_id: &str, spec: &StreamSpec) -> Result<LoopbackStream, ReopenFailure> {
    let enumerator = enumerator().map_err(ReopenFailure::Transient)?;
    let device = device_by_id(&enumerator, device_id).map_err(ReopenFailure::Transient)?;
    let (client, format) = activate_client(&device).map_err(ReopenFailure::Transient)?;
    if !format.matches(spec) {
        return Err(ReopenFailure::Fatal(CaptureError::Backend(
            "формат устройства вывода изменился — захват пересоздаётся".to_string(),
        )));
    }
    open_stream_with(client, format).map_err(ReopenFailure::Transient)
}

fn open_stream_with(client: IAudioClient, format: SampleFormat) -> Result<LoopbackStream, CaptureError> {
    let mix = MixFormat(unsafe { client.GetMixFormat() }.map_err(backend_error)?);
    let buffer_duration = (CLIENT_BUFFER_SECONDS * REFERENCE_TIMES_PER_SECOND as f64) as i64;
    unsafe {
        client.Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK,
            buffer_duration,
            0,
            mix.0,
            None,
        )
    }
    .map_err(backend_error)?;
    let capture: IAudioCaptureClient = unsafe { client.GetService() }.map_err(backend_error)?;
    let poll_interval = poll_interval(&client);
    unsafe { client.Start() }.map_err(backend_error)?;
    Ok(LoopbackStream {
        client,
        capture,
        format,
        poll_interval,
    })
}

fn decode_samples(out: &mut Vec<f32>, data: *const u8, frames: usize, format: SampleFormat) {
    let count = frames * format.channels;
    out.clear();
    out.reserve(count);
    for index in 0..count {
        let sample = unsafe { data.add(index * format.bytes_per_sample) };
        let value = match (format.is_float, format.bytes_per_sample) {
            (true, FLOAT_SAMPLE_BYTES) => unsafe {
                std::ptr::read_unaligned(sample as *const f32)
            },
            (false, INT16_SAMPLE_BYTES) => {
                let raw = unsafe { std::ptr::read_unaligned(sample as *const i16) };
                f32::from(raw) / I16_SCALE
            }
            _ => {
                let raw = unsafe { std::ptr::read_unaligned(sample as *const i32) };
                raw as f32 / I32_SCALE
            }
        };
        out.push(value);
    }
}

struct Timeline {
    sample_rate: u32,
    channels: usize,
    opened_at: Option<Instant>,
    frames: u64,
}

impl Timeline {
    fn new(spec: &StreamSpec) -> Self {
        Self {
            sample_rate: spec.sample_rate,
            channels: spec.channels,
            opened_at: None,
            frames: 0,
        }
    }

    fn gate(&mut self, wants_samples: bool) {
        if !wants_samples {
            self.opened_at = None;
            return;
        }
        if self.opened_at.is_none() {
            self.opened_at = Some(Instant::now());
            self.frames = 0;
        }
    }

    fn on_frames(&mut self, frames: usize) {
        self.frames += frames as u64;
    }

    /// Сколько кадров тишины дозаполнить, чтобы таймлайн сошёлся с часами.
    /// Разрыв больше `MAX_SILENCE_GAP` не догоняется, а списывается: после
    /// простоя (устройство отсутствовало, машина спала) таймлайн переякоривается,
    /// иначе один опрос требовал бы аллокацию на весь простой.
    fn missing_frames(&mut self) -> usize {
        let Some(opened_at) = self.opened_at else {
            return 0;
        };
        let expected = (opened_at.elapsed().as_secs_f64() * f64::from(self.sample_rate)) as u64;
        let cap = (MAX_SILENCE_GAP.as_secs_f64() * f64::from(self.sample_rate)) as u64;
        let missing = expected.saturating_sub(self.frames);
        if missing > cap {
            self.frames = expected - cap;
            return cap as usize;
        }
        missing as usize
    }

    /// Поток переоткрыт: таймлайн заводится заново на следующем опросе.
    fn reset(&mut self) {
        self.opened_at = None;
    }

    fn samples_for(&self, frames: usize) -> usize {
        frames * self.channels
    }
}

fn drain_packets(
    stream: &LoopbackStream,
    ctx: &mut CallbackCtx,
    scratch: &mut Vec<f32>,
    stop: &AtomicBool,
) -> Result<usize, CaptureError> {
    let mut delivered = 0usize;
    while !stop.load(Ordering::Acquire) {
        let available = unsafe { stream.capture.GetNextPacketSize() }.map_err(backend_error)?;
        if available == 0 {
            return Ok(delivered);
        }
        let mut data: *mut u8 = std::ptr::null_mut();
        let mut frames: u32 = 0;
        let mut flags: u32 = 0;
        unsafe {
            stream
                .capture
                .GetBuffer(&mut data, &mut frames, &mut flags, None, None)
        }
        .map_err(backend_error)?;

        let silent = flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0;
        if frames > 0 && ctx.wants_samples() {
            if silent || data.is_null() {
                scratch.clear();
                scratch.resize(frames as usize * stream.format.channels, 0.0);
            } else {
                decode_samples(scratch, data, frames as usize, stream.format);
            }
            ctx.push_samples(scratch);
        }
        delivered += frames as usize;

        unsafe { stream.capture.ReleaseBuffer(frames) }.map_err(backend_error)?;
        if frames == 0 {
            return Ok(delivered);
        }
    }
    Ok(delivered)
}

fn push_silence(ctx: &mut CallbackCtx, scratch: &mut Vec<f32>, samples: usize) {
    scratch.clear();
    scratch.resize(samples, 0.0);
    ctx.push_samples(scratch);
}

fn run_stream(
    stream: &LoopbackStream,
    ctx: &mut CallbackCtx,
    timeline: &mut Timeline,
    stop: &AtomicBool,
) -> Result<(), CaptureError> {
    let mut scratch: Vec<f32> = Vec::new();
    while !stop.load(Ordering::Acquire) {
        let wants_samples = ctx.wants_samples();
        timeline.gate(wants_samples);
        let delivered = drain_packets(stream, ctx, &mut scratch, stop)?;
        timeline.on_frames(delivered);
        if wants_samples && delivered == 0 {
            let missing = timeline.missing_frames();
            if missing > 0 {
                push_silence(ctx, &mut scratch, timeline.samples_for(missing));
                timeline.on_frames(missing);
            }
        }
        std::thread::sleep(stream.poll_interval);
    }
    Ok(())
}

fn capture_main(
    source: Source,
    mut ctx: Box<CallbackCtx>,
    spec: StreamSpec,
    stop: Arc<AtomicBool>,
    ready: mpsc::Sender<Result<(), CaptureError>>,
) {
    let Ok(_com) = ComGuard::enter() else {
        let _ = ready.send(Err(CaptureError::Backend(
            "COM недоступен в потоке захвата".to_string(),
        )));
        return;
    };
    let mut timeline = Timeline::new(&spec);
    let mut announced = false;

    while !stop.load(Ordering::Acquire) {
        match open_stream(&source.device_id, &spec) {
            Ok(stream) => {
                if !announced {
                    announced = true;
                    let _ = ready.send(Ok(()));
                }
                timeline.reset();
                if let Err(e) = run_stream(&stream, &mut ctx, &mut timeline, &stop) {
                    eprintln!("поток захвата прерван, переоткрываю: {e}");
                }
            }
            Err(ReopenFailure::Transient(e) | ReopenFailure::Fatal(e)) if !announced => {
                let _ = ready.send(Err(e));
                return;
            }
            Err(ReopenFailure::Transient(e)) => {
                eprintln!("не удалось переоткрыть захват: {e}");
            }
            Err(ReopenFailure::Fatal(e)) => {
                // Раньше поток ретраил это раз в секунду вечно, а фасад
                // оставался «живым» с нулевым таймлайном: каждый PTT давал
                // «запись слишком короткая». Теперь фасад узнаёт, что капчер
                // мёртв, и `recording.rs` пересоздаёт его на следующем PTT.
                eprintln!("захват остановлен окончательно: {e}");
                ctx.mark_dead();
                return;
            }
        }
        sleep_unless_stopped(&stop, REOPEN_DELAY);
    }
}
