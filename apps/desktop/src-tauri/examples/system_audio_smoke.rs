//! Native macOS capture smoke test. Plays a quiet tone through the current
//! output and checks for that frequency in captured PCM. No microphone is
//! opened; captured audio stays in memory and never goes to STT or a file.

#[cfg(target_os = "macos")]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    use harpyhare_lib::{audio, capture::AudioCapture};
    use std::{f32::consts::TAU, io::Write, time::Duration};

    const TONE_HZ: f32 = 997.0;
    let args: Vec<String> = std::env::args().skip(1).collect();
    let expect_silence = args.iter().any(|arg| arg == "--expect-silence");
    let selected = args.iter().find(|arg| !arg.starts_with("--"));
    let devices = harpyhare_lib::capture::list_devices()?;
    let selected_device = selected
        .map(|value| {
            devices
                .outputs
                .iter()
                .find(|d| d.uid == *value || d.name == *value)
                .ok_or_else(|| format!("Output device not found: {value}"))
        })
        .transpose()?;
    println!(
        "capture={}, playback={}",
        selected_device.map_or("system default", |d| d.name.as_str()),
        devices
            .outputs
            .iter()
            .find(|d| d.is_default)
            .map_or("unknown", |d| d.name.as_str())
    );
    let mut capture = AudioCapture::system(selected_device.map(|d| d.uid.as_str()), 0)?;
    let tone: Vec<f32> = (0..audio::TARGET_SAMPLE_RATE * 2)
        .map(|i| (TAU * TONE_HZ * i as f32 / audio::TARGET_SAMPLE_RATE as f32).sin() * 0.2)
        .collect();
    let mut file = tempfile::Builder::new().suffix(".wav").tempfile()?;
    file.write_all(&audio::encode_wav_16k_mono(&tone)?)?;
    capture.start(None)?;
    std::thread::sleep(Duration::from_millis(500));
    let playback = std::process::Command::new("/usr/bin/afplay")
        .args(["-v", "0.2"])
        .arg(file.path())
        .status()?;
    std::thread::sleep(Duration::from_millis(500));
    let captured = capture.finish()?;
    assert!(playback.success(), "test tone playback failed");

    // A narrow-band check distinguishes our signal from unrelated audio.
    let peak = captured
        .chunks_exact(1600)
        .map(|chunk| {
            let (re, im) = chunk
                .iter()
                .enumerate()
                .fold((0.0f32, 0.0f32), |(re, im), (i, x)| {
                    let phase = TAU * TONE_HZ * i as f32 / audio::TARGET_SAMPLE_RATE as f32;
                    (re + x * phase.cos(), im + x * phase.sin())
                });
            2.0 * re.hypot(im) / chunk.len() as f32
        })
        .fold(0.0f32, f32::max);
    println!(
        "captured_samples={}, tone_amplitude={peak:.6}",
        captured.len()
    );
    if expect_silence {
        assert!(
            peak < 0.001,
            "the tone leaked from another output into the selected source"
        );
    } else {
        assert!(
            peak > 0.001,
            "the system capture did not receive the test tone"
        );
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("This native smoke test requires macOS and afplay.");
}
