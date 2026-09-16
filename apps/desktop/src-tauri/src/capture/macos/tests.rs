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

#[test]
fn private_device_names_match_their_cf_literals() {
    assert_eq!(AGGREGATE_DEVICE_NAME.to_string(), SYSTEM_TAP_DEVICE_NAME);
    assert_eq!(
        MICROPHONE_AGGREGATE_NAME.to_string(),
        MICROPHONE_DEVICE_NAME
    );
}
