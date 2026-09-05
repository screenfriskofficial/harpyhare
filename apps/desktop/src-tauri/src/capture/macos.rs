use cidre::{
    cat, cf,
    core_audio::{self as ca, aggregate_device_keys as agg_keys, sub_device_keys as sub_keys},
    ns, os,
};

use super::{
    AudioDeviceInfo, AudioDevices, CallbackCtx, CaptureError, DeviceChangeHandler, StreamSpec,
};

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
    tap: Option<ca::TapGuard>,
    microphone: bool,
    device: ca::AggregateDevice,
}

/// Порядок полей — это порядок drop, и он обязателен: сначала останавливается
/// устройство (`_started`), после чего IO-колбэк гарантированно не в полёте,
/// потом уничтожается тап и только затем — `_ctx`, на который колбэк ссылался.
pub struct Running {
    _started: ca::hardware::StartedDevice<ca::AggregateDevice>,
    _tap: Option<ca::TapGuard>,
    _ctx: Box<IoCtx>,
}

// SAFETY: внутри — идентификаторы объектов Core Audio (`u32`-хэндлы, потокобезопасны
// по контракту HAL), guard тапа с таким же идентификатором и `Box<CallbackCtx>`,
// к которому из Rust после `start` никто не обращается: его читает только
// C-колбэк в IO-потоке, а он останавливается раньше, чем `_ctx` дропается.
// Перемещение `Running` между потоками ничего из этого не нарушает.
unsafe impl Send for Running {}

pub fn list_devices() -> Result<AudioDevices, CaptureError> {
    let default_input = ca::System::default_input_device()
        .ok()
        .and_then(|d| d.uid().ok())
        .map(|u| u.to_string());
    let default_output = ca::System::default_output_device()
        .ok()
        .and_then(|d| d.uid().ok())
        .map(|u| u.to_string());
    let mut result = AudioDevices::default();
    for device in ca::System::devices().map_err(from_os)? {
        let (Ok(uid), Ok(name)) = (device.uid(), device.name()) else {
            continue;
        };
        let uid = uid.to_string();
        let name = name.to_string();
        if name == "audio-system-tap" || name == "audio-microphone" {
            continue;
        }
        for (input, list, default_uid) in [
            (true, &mut result.inputs, &default_input),
            (false, &mut result.outputs, &default_output),
        ] {
            let scope = if input {
                ca::PropScope::INPUT
            } else {
                ca::PropScope::OUTPUT
            };
            if device
                .stream_cfg(scope)
                .is_ok_and(|cfg| cfg.buffers().iter().any(|b| b.number_channels > 0))
            {
                list.push(AudioDeviceInfo {
                    uid: uid.clone(),
                    name: name.clone(),
                    is_default: default_uid.as_deref() == Some(&uid),
                });
            }
        }
    }
    Ok(result)
}

fn resolve_device(uid: Option<&str>, input: bool) -> Result<ca::Device, CaptureError> {
    let Some(uid) = uid else {
        return if input {
            ca::System::default_input_device()
        } else {
            ca::System::default_output_device()
        }
        .map_err(from_os);
    };
    ca::System::devices().map_err(from_os)?.into_iter()
        .find(|d| d.uid().is_ok_and(|value| value.to_string() == uid))
        .ok_or_else(|| CaptureError::Backend(if input {
            "Выбранный микрофон недоступен — подключите его или выберите другой вход".into()
        } else {
            "Выбранный аудиовыход недоступен — подключите его или выберите другой источник собеседника".into()
        }))
}

fn stream_spec(asbd: &cat::audio::StreamBasicDesc) -> Result<StreamSpec, CaptureError> {
    if !asbd
        .format_flags
        .contains(cat::audio::FormatFlags::IS_FLOAT)
        || asbd
            .format_flags
            .contains(cat::audio::FormatFlags::IS_NON_INTERLEAVED)
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

/// Capture only the explicitly selected render endpoint. The physical device
/// itself is never added to the aggregate, so its microphone cannot be opened.
fn system_tap_description(output_uid: &cf::String) -> cidre::arc::R<ca::TapDesc> {
    let mut desc = ca::TapDesc::with_processes_and_device(&ns::Array::new(), output_uid.as_ns(), 0);
    desc.set_exclusive(true);
    desc.set_private(true);
    desc
}

fn system_aggregate_description(
    tap_uid: &cf::String,
) -> cidre::arc::R<cf::DictionaryOf<cf::String, cf::Type>> {
    let sub_tap = cf::DictionaryOf::with_keys_values(&[sub_keys::uid()], &[tap_uid.as_type_ref()]);
    // A tap-only aggregate has no hardware subdevices. channels-in=0 in a
    // subdevice dictionary describes state; it does not disable its inputs.
    cf::DictionaryOf::with_keys_values(
        &[
            agg_keys::is_private(),
            agg_keys::tap_auto_start(),
            agg_keys::name(),
            agg_keys::uid(),
            agg_keys::tap_list(),
        ],
        &[
            cf::Boolean::value_true().as_type_ref(),
            cf::Boolean::value_true(),
            AGGREGATE_DEVICE_NAME,
            &cf::Uuid::new().to_cf_string(),
            &cf::ArrayOf::from_slice(&[sub_tap.as_ref()]),
        ],
    )
}

pub fn open(output_device_uid: Option<&str>) -> Result<(Source, StreamSpec), CaptureError> {
    let output = resolve_device(output_device_uid, false)?;
    let uid = output.uid().map_err(from_os)?;
    let tap_desc = system_tap_description(&uid);
    let tap = tap_desc.create_process_tap().map_err(from_os)?;
    let tap_uid = tap.uid().map_err(from_os)?;
    let spec = stream_spec(&tap.asbd().map_err(from_os)?)?;
    let device =
        ca::AggregateDevice::with_desc(&system_aggregate_description(&tap_uid)).map_err(from_os)?;
    // Fail closed if HAL ever supplies anything beyond the one tap stream;
    // matching buffers by channel count cannot establish their source identity.
    if !device.full_sub_device_list().map_err(from_os)?.is_empty() {
        return Err(CaptureError::Backend(
            "системный захват содержит физический аудиовход".into(),
        ));
    }
    let input = device.input_stream_cfg().map_err(from_os)?;
    if input.number_buffers() != 1
        || input.buffers().first().map(|b| b.number_channels as usize) != Some(spec.channels)
    {
        return Err(CaptureError::Backend(
            "неожиданные входные каналы системного захвата".into(),
        ));
    }
    eprintln!(
        "[capture] system tap: no hardware inputs, {} channels",
        spec.channels
    );
    Ok((
        Source {
            tap: Some(tap),
            device,
            microphone: false,
        },
        spec,
    ))
}

struct IoCtx {
    capture: Box<CallbackCtx>,
    microphone: bool,
}

pub fn open_microphone(
    input_device_uid: Option<&str>,
) -> Result<(Source, StreamSpec), CaptureError> {
    let input = resolve_device(input_device_uid, true)?;
    let asbd = input.input_asbd().map_err(from_os)?;
    if !asbd
        .format_flags
        .contains(cat::audio::FormatFlags::IS_FLOAT)
        || asbd.bits_per_channel != F32_BITS_PER_CHANNEL
    {
        return Err(CaptureError::Backend(
            "микрофон не поддерживает Float32 PCM".into(),
        ));
    }
    let uid = input.uid().map_err(from_os)?;
    let no_output = cf::Number::from_i32(0);
    let sub = cf::DictionaryOf::with_keys_values(
        &[sub_keys::uid(), sub_keys::channels_out()],
        &[uid.as_type_ref(), no_output.as_type_ref()],
    );
    let dict = cf::DictionaryOf::with_keys_values(
        &[
            agg_keys::is_private(),
            agg_keys::name(),
            agg_keys::main_sub_device(),
            agg_keys::uid(),
            agg_keys::sub_device_list(),
        ],
        &[
            cf::Boolean::value_true().as_type_ref(),
            cf::str!(c"audio-microphone"),
            &uid,
            &cf::Uuid::new().to_cf_string(),
            &cf::ArrayOf::from_slice(&[sub.as_ref()]),
        ],
    );
    let device = ca::AggregateDevice::with_desc(&dict).map_err(from_os)?;
    Ok((
        Source {
            tap: None,
            device,
            microphone: true,
        },
        StreamSpec {
            sample_rate: asbd.sample_rate as u32,
            channels: 1,
        },
    ))
}

/// HAL input can be interleaved or planar. Downmix every input channel into
/// bounded stack storage; the real-time callback never allocates or locks.
fn push_microphone(input: &cat::AudioBufList<1>, ctx: &mut CallbackCtx) {
    mix_microphone_buffers(input, |samples| ctx.push_samples(samples));
}

fn mix_microphone_buffers<const N: usize>(
    input: &cat::AudioBufList<N>,
    mut push: impl FnMut(&[f32]),
) {
    let count = input.number_buffers as usize;
    if count == 0 || count > MAX_INPUT_BUFFERS {
        return;
    }
    // SAFETY: HAL supplies number_buffers contiguous AudioBuffer entries.
    let buffers = unsafe { std::slice::from_raw_parts(input.buffers.as_ptr(), count) };
    if buffers.iter().any(|b| {
        b.data.is_null()
            || b.number_channels == 0
            || !(b.data as usize).is_multiple_of(std::mem::align_of::<f32>())
            || !(b.data_bytes_size as usize).is_multiple_of(SAMPLE_BYTES)
    }) {
        return;
    }
    let channels: usize = buffers.iter().map(|b| b.number_channels as usize).sum();
    let frames = buffers
        .iter()
        .map(|b| b.data_bytes_size as usize / SAMPLE_BYTES / b.number_channels as usize)
        .min()
        .unwrap_or(0);
    const CHUNK_FRAMES: usize = 512;
    let mut mono = [0.0f32; CHUNK_FRAMES];
    for start in (0..frames).step_by(CHUNK_FRAMES) {
        let len = (frames - start).min(CHUNK_FRAMES);
        mono[..len].fill(0.0);
        for buffer in buffers {
            // SAFETY: Float32 format validated at open, alignment/length above.
            let samples = unsafe {
                std::slice::from_raw_parts(
                    buffer.data.cast::<f32>(),
                    buffer.data_bytes_size as usize / SAMPLE_BYTES,
                )
            };
            let width = buffer.number_channels as usize;
            for (index, value) in mono[..len].iter_mut().enumerate() {
                *value += samples[(start + index) * width..(start + index + 1) * width]
                    .iter()
                    .sum::<f32>();
            }
        }
        for sample in &mut mono[..len] {
            *sample /= channels as f32;
        }
        push(&mono[..len]);
    }
}

pub fn start(source: Source, ctx: Box<CallbackCtx>) -> Result<Running, CaptureError> {
    let Source {
        tap,
        device,
        microphone,
    } = source;
    let mut ctx = Box::new(IoCtx {
        capture: ctx,
        microphone,
    });
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
    ctx: Option<&mut IoCtx>,
) -> os::Status {
    let Some(ctx) = ctx else {
        return os::Status::NO_ERR;
    };

    let microphone = ctx.microphone;
    let ctx = &mut ctx.capture;
    if !ctx.wants_samples() {
        return os::Status::NO_ERR;
    }

    if microphone {
        push_microphone(input_data, ctx);
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

/// A system aggregate contains exactly one tap and no hardware inputs.
/// Never fall back to another buffer, even when its channel count matches.
fn tap_buffer<const N: usize>(
    input_data: &cat::AudioBufList<N>,
    tap_channels: usize,
) -> Option<&cat::AudioBuf> {
    if input_data.number_buffers != 1 {
        return None;
    }
    let buffer = input_data.buffers.first()?;
    (buffer.number_channels as usize == tap_channels).then_some(buffer)
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

#[cfg(test)]
mod microphone_tests {
    use super::*;

    fn buffer(samples: &mut [f32], channels: u32) -> cat::AudioBuf {
        cat::AudioBuf {
            number_channels: channels,
            data_bytes_size: std::mem::size_of_val(samples) as u32,
            data: samples.as_mut_ptr().cast(),
        }
    }

    #[test]
    fn microphone_accepts_planar_and_interleaved_hal_input() {
        let mut left = [0.2f32, 0.4];
        let mut right = [0.6f32, 0.8];
        let planar = cat::AudioBufList {
            number_buffers: 2,
            buffers: [buffer(&mut left, 1), buffer(&mut right, 1)],
        };
        let mut result = Vec::new();
        mix_microphone_buffers(&planar, |samples| result.extend_from_slice(samples));
        assert_eq!(result, vec![0.4, 0.6]);
        let mut stereo = [0.2f32, 0.6, 0.4, 0.8];
        let interleaved = cat::AudioBufList {
            number_buffers: 1,
            buffers: [buffer(&mut stereo, 2)],
        };
        let mut result2 = Vec::new();
        mix_microphone_buffers(&interleaved, |samples| result2.extend_from_slice(samples));
        assert_eq!(result, result2);
    }

    #[test]
    fn microphone_delivers_large_callbacks_in_bounded_chunks() {
        let mut audio = vec![0.5f32; 1500];
        let input = cat::AudioBufList {
            number_buffers: 1,
            buffers: [buffer(&mut audio, 1)],
        };
        let mut lengths = Vec::new();
        mix_microphone_buffers(&input, |samples| lengths.push(samples.len()));
        assert_eq!(lengths, [512, 512, 476]);
    }
}

#[cfg(test)]
mod system_tests {
    use super::*;

    #[test]
    fn system_aggregate_never_adds_a_physical_device_or_its_input_channels() {
        let desc = system_aggregate_description(cf::str!(c"test-output-tap"));
        assert!(desc.get(agg_keys::tap_list()).is_some());
        assert!(desc.get(agg_keys::sub_device_list()).is_none());
        assert!(desc.get(agg_keys::main_sub_device()).is_none());
    }

    #[test]
    fn system_tap_captures_only_the_selected_output() {
        let uid = cf::str!(c"chosen-output");
        let desc = system_tap_description(uid);
        assert_eq!(desc.device_uid().unwrap().to_string(), uid.to_string());
        assert!(desc.is_exclusive());
        assert!(desc.is_private());
        assert!(desc.processes().is_empty());
        assert_eq!(desc.stream().unwrap().as_integer(), 0);
    }

    fn empty_buffer(channels: u32) -> cat::AudioBuf {
        cat::AudioBuf {
            number_channels: channels,
            data_bytes_size: 0,
            data: std::ptr::null_mut(),
        }
    }

    #[test]
    fn system_capture_refuses_ambiguous_input_instead_of_guessing_the_tap() {
        let mixed = cat::AudioBufList {
            number_buffers: 2,
            buffers: [empty_buffer(2), empty_buffer(2)],
        };
        assert!(tap_buffer(&mixed, 2).is_none());
        let microphone = cat::AudioBufList {
            number_buffers: 1,
            buffers: [empty_buffer(1)],
        };
        assert!(tap_buffer(&microphone, 2).is_none());
        let missing = cat::AudioBufList::<0> {
            number_buffers: 0,
            buffers: [],
        };
        assert!(tap_buffer(&missing, 2).is_none());
    }

    #[test]
    fn system_capture_accepts_the_single_exact_tap_buffer() {
        let input = cat::AudioBufList {
            number_buffers: 1,
            buffers: [empty_buffer(2)],
        };
        assert!(std::ptr::eq(
            tap_buffer(&input, 2).unwrap(),
            &input.buffers[0]
        ));
    }
}
