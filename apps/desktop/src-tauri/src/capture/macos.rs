use cidre::{
    cat, cf,
    core_audio::{self as ca, aggregate_device_keys as agg_keys, sub_device_keys as sub_keys},
    ns, os,
};

use super::{CallbackCtx, CaptureError, DeviceChangeHandler, OutputDeviceInfo, StreamSpec};

const OS_STATUS_ILLEGAL_OPERATION: i32 = i32::from_be_bytes(*b"!hog");
const SAMPLE_BYTES: usize = std::mem::size_of::<f32>();
const F32_BITS_PER_CHANNEL: u32 = (SAMPLE_BYTES * 8) as u32;
const AGGREGATE_DEVICE_NAME: &cf::String = cf::str!(c"audio-system-tap");
/// Больше входных буферов у aggregate-устройства не бывает; защита от мусора
/// в `number_buffers`, прочитанного из чужой C-структуры.
const MAX_INPUT_BUFFERS: usize = 16;

fn from_os(err: os::Error) -> CaptureError {
    if err.0.get() == OS_STATUS_ILLEGAL_OPERATION {
        CaptureError::PermissionDenied
    } else {
        CaptureError::Backend(format!("Core Audio: {err}"))
    }
}

pub struct Source {
    tap: ca::TapGuard,
    device: ca::AggregateDevice,
}

/// Порядок полей — это порядок drop, и он обязателен: сначала останавливается
/// устройство (`_started`), после чего IO-колбэк гарантированно не в полёте,
/// потом уничтожается тап и только затем — `_ctx`, на который колбэк ссылался.
pub struct Running {
    _started: ca::hardware::StartedDevice<ca::AggregateDevice>,
    _tap: ca::TapGuard,
    _ctx: Box<CallbackCtx>,
}

// SAFETY: внутри — идентификаторы объектов Core Audio (`u32`-хэндлы, потокобезопасны
// по контракту HAL), guard тапа с таким же идентификатором и `Box<CallbackCtx>`,
// к которому из Rust после `start` никто не обращается: его читает только
// C-колбэк в IO-потоке, а он останавливается раньше, чем `_ctx` дропается.
// Перемещение `Running` между потоками ничего из этого не нарушает.
unsafe impl Send for Running {}

fn device_has_output(device: &ca::Device) -> bool {
    device.output_asbd().is_ok()
}

pub fn list_output_devices() -> Vec<OutputDeviceInfo> {
    let Ok(devices) = ca::System::devices() else {
        return Vec::new();
    };
    devices
        .iter()
        .filter(|d| device_has_output(d))
        .filter_map(|d| {
            Some(OutputDeviceInfo {
                uid: d.uid().ok()?.to_string(),
                name: d.name().ok()?.to_string(),
            })
        })
        .collect()
}

fn find_output_device_by_uid(uid: &str) -> Option<ca::Device> {
    let devices = ca::System::devices().ok()?;
    devices
        .into_iter()
        .find(|d| device_has_output(d) && d.uid().map(|u| u.to_string() == uid).unwrap_or(false))
}

fn resolve_output_device(uid: Option<&str>) -> Result<ca::Device, CaptureError> {
    if let Some(uid) = uid {
        if let Some(device) = find_output_device_by_uid(uid) {
            return Ok(device);
        }
        eprintln!("устройство захвата {uid:?} не найдено — используется системный вывод");
    }
    ca::System::default_output_device().map_err(from_os)
}

fn stream_spec(asbd: &cat::audio::StreamBasicDesc) -> Result<StreamSpec, CaptureError> {
    if !asbd.format_flags.contains(cat::audio::FormatFlags::IS_FLOAT)
        || asbd.format_flags.contains(cat::audio::FormatFlags::IS_NON_INTERLEAVED)
        || asbd.bits_per_channel != F32_BITS_PER_CHANNEL
    {
        return Err(CaptureError::Backend(format!(
            "неожиданный формат tap: format_flags={:#010x}, bits_per_channel={}",
            asbd.format_flags.0, asbd.bits_per_channel
        )));
    }
    Ok(StreamSpec {
        sample_rate: asbd.sample_rate as u32,
        channels: asbd.channels_per_frame as usize,
    })
}

pub fn open(output_device_uid: Option<&str>) -> Result<(Source, StreamSpec), CaptureError> {
    let tap_desc = ca::TapDesc::with_stereo_global_tap_excluding_processes(&ns::Array::new());
    let tap = tap_desc.create_process_tap().map_err(from_os)?;
    let tap_uid = tap.uid().map_err(from_os)?;
    let spec = stream_spec(&tap.asbd().map_err(from_os)?)?;

    let output_device = resolve_output_device(output_device_uid)?;
    let output_uid = output_device.uid().map_err(from_os)?;
    let sub_device =
        cf::DictionaryOf::with_keys_values(&[sub_keys::uid()], &[output_uid.as_type_ref()]);
    let sub_tap = cf::DictionaryOf::with_keys_values(&[sub_keys::uid()], &[tap_uid.as_type_ref()]);

    let dict = cf::DictionaryOf::with_keys_values(
        &[
            agg_keys::is_private(),
            agg_keys::is_stacked(),
            agg_keys::tap_auto_start(),
            agg_keys::name(),
            agg_keys::main_sub_device(),
            agg_keys::uid(),
            agg_keys::sub_device_list(),
            agg_keys::tap_list(),
        ],
        &[
            cf::Boolean::value_true().as_type_ref(),
            cf::Boolean::value_false(),
            cf::Boolean::value_true(),
            AGGREGATE_DEVICE_NAME,
            &output_uid,
            &cf::Uuid::new().to_cf_string(),
            &cf::ArrayOf::from_slice(&[sub_device.as_ref()]),
            &cf::ArrayOf::from_slice(&[sub_tap.as_ref()]),
        ],
    );
    let device = ca::AggregateDevice::with_desc(&dict).map_err(from_os)?;

    Ok((Source { tap, device }, spec))
}

pub fn start(source: Source, mut ctx: Box<CallbackCtx>) -> Result<Running, CaptureError> {
    let Source { tap, device } = source;
    let proc_id = device
        .create_io_proc_id(io_proc, Some(ctx.as_mut()))
        .map_err(from_os)?;
    let started = ca::device_start(device, Some(proc_id)).map_err(from_os)?;
    Ok(Running {
        _started: started,
        _tap: tap,
        _ctx: ctx,
    })
}

extern "C" fn io_proc(
    _device: ca::Device,
    _now: &cat::AudioTimeStamp,
    input_data: &cat::AudioBufList<1>,
    _input_time: &cat::AudioTimeStamp,
    _output_data: &mut cat::AudioBufList<1>,
    _output_time: &cat::AudioTimeStamp,
    ctx: Option<&mut CallbackCtx>,
) -> os::Status {
    let Some(ctx) = ctx else {
        return os::Status::NO_ERR;
    };

    if !ctx.wants_samples() {
        return os::Status::NO_ERR;
    }

    let Some(abuf) = tap_buffer(input_data, ctx.shared.channels) else {
        return os::Status::NO_ERR;
    };
    if abuf.data.is_null() || abuf.data_bytes_size == 0 {
        return os::Status::NO_ERR;
    }
    let bytes = abuf.data_bytes_size as usize;
    // Паника здесь недопустима (граница FFI в IO-потоке HAL) — неполный
    // сэмпл в хвосте просто отбрасывается.
    if !bytes.is_multiple_of(SAMPLE_BYTES)
        || !(abuf.data as usize).is_multiple_of(std::mem::align_of::<f32>())
    {
        return os::Status::NO_ERR;
    }
    let n = bytes / SAMPLE_BYTES;
    let samples = unsafe { std::slice::from_raw_parts(abuf.data as *const f32, n) };
    ctx.push_samples(samples);

    os::Status::NO_ERR
}

/// Буфер тапа среди входных буферов aggregate-устройства.
///
/// Обычно он один. Но если у устройства вывода есть и вход (гарнитура,
/// USB-интерфейс), aggregate отдаёт ещё и его микрофон, и слепое `buffers[0]`
/// могло молча записывать микрофон вместо системного звука. Тап узнаётся по
/// числу каналов (его формат известен из `open`); при нескольких кандидатах
/// берётся последний — потоки тапов идут после потоков sub-устройств.
fn tap_buffer(input_data: &cat::AudioBufList<1>, tap_channels: usize) -> Option<&cat::AudioBuf> {
    let count = (input_data.number_buffers as usize).min(MAX_INPUT_BUFFERS);
    if count == 0 {
        return None;
    }
    if count == 1 {
        return Some(&input_data.buffers[0]);
    }
    // SAFETY: у C-структуры AudioBufferList за `mNumberBuffers` лежат ровно
    // `mNumberBuffers` смежных `AudioBuffer`; `count` ограничен сверху.
    let buffers: &[cat::AudioBuf] =
        unsafe { std::slice::from_raw_parts(input_data.buffers.as_ptr(), count) };
    buffers
        .iter()
        .rev()
        .find(|b| b.number_channels as usize == tap_channels)
        .or_else(|| buffers.last())
}

/// Колбэк HAL: паника из `notify()` (например, при остановленном рантайме на
/// выходе) не должна раскручиваться в кадры Core Audio — ловим её здесь.
extern "C-unwind" fn on_default_output_device_changed(
    _obj: ca::Obj,
    _number_addresses: u32,
    _addresses: *const ca::PropAddr,
    client_data: *mut DeviceChangeHandler,
) -> os::Status {
    let notify = unsafe { &*client_data };
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(notify));
    os::Status::NO_ERR
}

pub fn watch_default_output_device(on_change: DeviceChangeHandler) {
    let client_data = Box::leak(Box::new(on_change));
    let addr = ca::PropSelector::HW_DEFAULT_OUTPUT_DEVICE.global_addr();
    if let Err(e) =
        ca::System::OBJ.add_prop_listener(&addr, on_default_output_device_changed, client_data)
    {
        eprintln!("не удалось подписаться на смену аудио-вывода: {e:?}");
    }
}
