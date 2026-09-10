use super::*;

#[test]
fn cancellation_before_registration_and_stale_cancel_cannot_start_or_stop_another_run() {
    let mut runs = RunRegistry::default();
    runs.cancel("old");
    assert_eq!(runs.begin("old").unwrap_err(), ErrorCode::Cancelled);
    let token = runs.begin("new").unwrap();
    runs.cancel("old");
    runs.finish("old");
    assert!(!token.is_cancelled());
    assert_eq!(runs.begin("other").unwrap_err(), ErrorCode::Retryable);
    runs.cancel("new");
    assert!(token.is_cancelled());
    runs.finish("new");
    assert!(runs.begin("other").is_ok());
}

#[test]
fn audio_meter_handles_silence_nan_and_clipping() {
    assert_eq!(level_percent(&[]), 0);
    assert_eq!(level_percent(&[0.0; 32]), 0);
    assert_eq!(level_percent(&[f32::NAN; 32]), 0);
    assert_eq!(level_percent(&[1.0; 32]), 100);
    assert!(level_percent(&[0.1; 32]) > level_percent(&[0.01; 32]));
}

struct FakeSpeech;
#[async_trait::async_trait]
impl stt::SttEngine for FakeSpeech {
    async fn transcribe(
        &self,
        _samples: &[f32],
        _keyterms: stt::Keyterms<'_>,
    ) -> Result<String, stt::SttError> {
        Ok("test speech".into())
    }
    async fn transcribe_stream(
        &self,
        _chunks: stt::AudioChunkStream,
        _terms: stt::Keyterms<'_>,
        _cancel: CancellationToken,
    ) -> Result<String, stt::SttError> {
        Ok("test speech".into())
    }
    async fn warm_up(&self) {}
}

#[tokio::test]
async fn speech_check_uses_real_engine_contract_and_keeps_preview_out_of_report() {
    let check = check_speech(
        Arc::new(FakeSpeech),
        Sample {
            source: CheckStep::Microphone,
            samples: vec![0.5; 100],
        },
        &settings::Settings::default(),
        &CancellationToken::new(),
    )
    .await;
    assert_eq!(check.status, CheckStatus::Passed);
    assert_eq!(check.preview.as_deref(), Some("test speech"));
    assert!(!serde_json::to_string(&diagnostics::get_diagnostics())
        .unwrap()
        .contains("test speech"));
}

#[tokio::test]
async fn cancelling_speech_check_is_not_reported_as_success() {
    let cancel = CancellationToken::new();
    cancel.cancel();
    let check = check_speech(
        Arc::new(FakeSpeech),
        Sample {
            source: CheckStep::SystemAudio,
            samples: vec![],
        },
        &settings::Settings::default(),
        &cancel,
    )
    .await;
    assert_eq!(check.error_code, Some(ErrorCode::Cancelled));
}
