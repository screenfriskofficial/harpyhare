use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

const RECORD_SECS: u64 = 5;
const PROGRESS_TICK: std::time::Duration = std::time::Duration::from_secs(1);
const SAMPLE_RATE_HZ: f32 = 16000.0;
const OUTPUT_WAV_PATH: &str = "out.wav";

fn counting_sink(streamed: Arc<AtomicUsize>) -> harpyhare_lib::capture::ChunkSink {
    Box::new(move |chunk: &[f32]| {
        streamed.fetch_add(chunk.len(), Ordering::Relaxed);
    })
}

fn main() {
    const EXAMPLE_BUFFER_SECS: u64 = 10;
    let mut cap = harpyhare_lib::capture::AudioCapture::system(None, EXAMPLE_BUFFER_SECS)
        .expect("создание tap");

    let streamed = Arc::new(AtomicUsize::new(0));
    cap.start(Some(counting_sink(Arc::clone(&streamed))))
        .expect("старт");
    for i in 1..=RECORD_SECS {
        std::thread::sleep(PROGRESS_TICK);
        println!("{i}s: recording_secs={:.2}", cap.recording_secs());
    }
    let s16k = cap.stop().expect("стоп");
    let via_sink = streamed.load(Ordering::Relaxed);
    println!(
        "итог: {} сэмплов 16кГц ({:.2}s), через sink ушло {}",
        s16k.len(),
        s16k.len() as f32 / SAMPLE_RATE_HZ,
        via_sink
    );
    assert_eq!(
        s16k.len(),
        via_sink,
        "sink получает ровно то же, что и буфер"
    );
    std::fs::write(
        OUTPUT_WAV_PATH,
        harpyhare_lib::audio::encode_wav_16k_mono(&s16k).unwrap(),
    )
    .unwrap();
    println!(
        "rms={} → {OUTPUT_WAV_PATH}",
        harpyhare_lib::audio::rms(&s16k)
    );
}
