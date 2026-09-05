//! Live diagnosis of every STT vendor in the registry against real audio.
//!
//!   cargo run --example stt_smoke -- путь/к/audio.wav [provider] [--stream]
//!
//! Keys come from `.env` by the registry's own naming — `<KEY_ID>_API_KEY` — so
//! a vendor added to the registry is picked up here without editing this file.

use harpyhare_lib::stt::{build_engine, registry, SttClientConfig};

/// Declared the way a preset would: `[keywords]: [...]` parsed on the frontend.
const DECLARED: &[&str] = &["Map", "Golang", "slice"];

const DESKTOP_ENV_PATH: &str = "../.env";
const WORKSPACE_ENV_PATH: &str = "../../../.env";
const LANGUAGE: &str = "ru";

fn key_env_var(key_id: &str) -> String {
    format!("{}_API_KEY", key_id.to_uppercase())
}

/// The app always uploads 16 kHz mono; read a WAV of that shape back into the
/// sample form `transcribe` expects.
fn samples_from_wav(path: &str) -> Vec<f32> {
    let mut reader = hound::WavReader::open(path).expect("не открылся WAV");
    let spec = reader.spec();
    assert!(
        spec.channels == 1
            && spec.sample_rate == harpyhare_lib::audio::TARGET_SAMPLE_RATE
            && spec.bits_per_sample == 16
            && spec.sample_format == hound::SampleFormat::Int,
        "нужен PCM WAV: 16 кГц, моно, 16 бит"
    );
    let samples: Vec<f32> = reader
        .samples::<i16>()
        .collect::<Result<Vec<_>, _>>()
        .expect("повреждённый WAV")
        .into_iter()
        .map(|s| f32::from(s) / f32::from(i16::MAX))
        .collect();
    assert!(!samples.is_empty(), "пустой WAV — нечего распознавать");
    samples
}

fn main() {
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let _ = dotenvy::from_path(manifest.join(DESKTOP_ENV_PATH));
    let _ = dotenvy::from_path(manifest.join(WORKSPACE_ENV_PATH));

    let mut args = std::env::args().skip(1);
    let Some(wav) = args.next() else {
        println!("укажи путь к 16кГц-моно WAV: cargo run --example stt_smoke -- audio.wav [provider] [--stream]");
        return;
    };
    let mut provider = None;
    let mut stream = false;
    for arg in args {
        if arg == "--stream" {
            stream = true;
        } else if provider.is_none() && registry::spec(&arg).is_some() {
            provider = Some(arg);
        } else {
            eprintln!("неизвестный провайдер или аргумент: {arg}");
            std::process::exit(1);
        }
    }
    let samples = samples_from_wav(&wav);
    println!(
        "{} сэмплов ({:.1} с)",
        samples.len(),
        samples.len() as f32 / 16_000.0
    );

    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async move {
        for spec in registry::PROVIDERS {
            if provider.as_deref().is_some_and(|id| id != spec.id) {
                continue;
            }
            let Ok(key) = std::env::var(key_env_var(spec.key_id)) else {
                println!(
                    "[skip] {}: нет {} в .env",
                    spec.id,
                    key_env_var(spec.key_id)
                );
                continue;
            };
            if key.is_empty() {
                println!("[skip] {}: пустой {}", spec.id, key_env_var(spec.key_id));
                continue;
            }
            let client = build_engine(
                spec,
                SttClientConfig {
                    api_key: key,
                    proxy_base_url: None,
                    language: LANGUAGE.into(),
                    translate: false,
                },
            );
            let declared: Vec<String> = DECLARED.iter().map(|s| (*s).to_string()).collect();
            for (label, terms) in [("без keyterms", Vec::new()), ("с keyterms ", declared)] {
                let started = std::time::Instant::now();
                let result = if stream {
                    let pcm = harpyhare_lib::audio::f32_to_i16le_bytes(&samples);
                    let chunks = futures_util::stream::iter([Ok(pcm)]);
                    client
                        .transcribe_stream(
                            Box::pin(chunks),
                            &terms,
                            tokio_util::sync::CancellationToken::new(),
                        )
                        .await
                } else {
                    client.transcribe(&samples, &terms).await
                };
                match result {
                    Ok(text) => {
                        println!(
                            "[OK ] {:<8} {label} {:>8?}  «{text}»",
                            spec.id,
                            started.elapsed()
                        )
                    }
                    Err(e) => println!("[ERR] {:<8} {label} {e}", spec.id),
                }
            }
        }
    });
}
