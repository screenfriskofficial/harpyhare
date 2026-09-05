//! Live diagnosis of every STT vendor in the registry against real audio.
//!
//!   cargo run --example stt_smoke -- путь/к/audio.wav
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
    reader
        .samples::<i16>()
        .filter_map(Result::ok)
        .map(|s| f32::from(s) / f32::from(i16::MAX))
        .collect()
}

fn main() {
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let _ = dotenvy::from_path(manifest.join(DESKTOP_ENV_PATH));
    let _ = dotenvy::from_path(manifest.join(WORKSPACE_ENV_PATH));

    let Some(wav) = std::env::args().nth(1) else {
        println!("укажи путь к 16кГц-моно WAV: cargo run --example stt_smoke -- audio.wav");
        return;
    };
    let samples = samples_from_wav(&wav);
    println!("{} сэмплов ({:.1} с)", samples.len(), samples.len() as f32 / 16_000.0);

    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async move {
        for spec in registry::PROVIDERS {
            let Ok(key) = std::env::var(key_env_var(spec.key_id)) else {
                println!("[skip] {}: нет {} в .env", spec.id, key_env_var(spec.key_id));
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
                match client.transcribe(&samples, &terms).await {
                    Ok(text) => {
                        println!("[OK ] {:<8} {label} {:>8?}  «{text}»", spec.id, started.elapsed())
                    }
                    Err(e) => println!("[ERR] {:<8} {label} {e}", spec.id),
                }
            }
        }
    });
}
