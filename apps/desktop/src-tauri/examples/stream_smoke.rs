use harpyhare_lib::stt::SttEngine;

const DOTENV_RELATIVE_PATH: &str = "../.env";
const GROQ_KEY_ENV: &str = "GROQ_API_KEY";
const CHANNEL_CAPACITY: usize = 64;
const SAMPLE_RATE_HZ: usize = 16000;
const CHUNK_MS: usize = 200;
const CHUNK_SAMPLES: usize = SAMPLE_RATE_HZ * CHUNK_MS / 1000;
const TONE_SECS: usize = 3;
const CHUNK_COUNT: usize = TONE_SECS * 1000 / CHUNK_MS;
const TONE_HZ: f32 = 220.0;
const TONE_AMPLITUDE: f32 = 0.3;

type ChunkResult = Result<Vec<u8>, std::io::Error>;

fn tone_chunk(step: usize) -> Vec<f32> {
    (0..CHUNK_SAMPLES)
        .map(|i| {
            let t = (step * CHUNK_SAMPLES + i) as f32 / SAMPLE_RATE_HZ as f32;
            (2.0 * std::f32::consts::PI * TONE_HZ * t).sin() * TONE_AMPLITUDE
        })
        .collect()
}

fn spawn_realtime_tone_producer(tx: tokio::sync::mpsc::Sender<ChunkResult>) {
    tokio::spawn(async move {
        for step in 0..CHUNK_COUNT {
            let samples = tone_chunk(step);
            if tx
                .send(Ok(harpyhare_lib::audio::f32_to_i16le_bytes(&samples)))
                .await
                .is_err()
            {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(CHUNK_MS as u64)).await;
        }
    });
}

/// Сырой PCM: WAV-заголовок подшивает сам клиент (контейнер — забота транспорта).
fn streaming_pcm_body(
    rx: tokio::sync::mpsc::Receiver<ChunkResult>,
) -> harpyhare_lib::stt::AudioChunkStream {
    Box::pin(futures_util::stream::unfold(rx, |mut rx| async move {
        rx.recv().await.map(|item| (item, rx))
    }))
}

fn main() {
    let _ = dotenvy::from_path(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(DOTENV_RELATIVE_PATH),
    );
    let key = std::env::var(GROQ_KEY_ENV).expect("GROQ_API_KEY в .env");
    let stt = harpyhare_lib::stt::SttHttpClient::for_provider(
        harpyhare_lib::stt::registry::PROVIDER_GROQ,
        key,
    );

    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async move {
        let (tx, rx) = tokio::sync::mpsc::channel::<ChunkResult>(CHANNEL_CAPACITY);
        spawn_realtime_tone_producer(tx);
        let body = streaming_pcm_body(rx);

        let t = std::time::Instant::now();
        let res = stt
            .transcribe_stream(body, &[], tokio_util::sync::CancellationToken::new())
            .await;
        println!("итог за {:?}: {:?}", t.elapsed(), res);
    });
}
