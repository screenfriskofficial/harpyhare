use super::*;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

struct Engine {
    system_calls: AtomicUsize,
    microphone_calls: AtomicUsize,
    fail_microphone: AtomicBool,
    panic_microphone: AtomicBool,
}

#[async_trait::async_trait]
impl stt::SttEngine for Engine {
    async fn transcribe(
        &self,
        samples: &[f32],
        _keyterms: stt::Keyterms<'_>,
    ) -> Result<String, stt::SttError> {
        tokio::task::yield_now().await;
        if samples[0] > 0.0 {
            self.system_calls.fetch_add(1, Ordering::SeqCst);
            // Let the microphone fail before this successful request finishes.
            tokio::task::yield_now().await;
            Ok("Question".into())
        } else {
            self.microphone_calls.fetch_add(1, Ordering::SeqCst);
            assert!(
                !self.panic_microphone.swap(false, Ordering::SeqCst),
                "provider panic while recognizing microphone"
            );
            if self.fail_microphone.swap(false, Ordering::SeqCst) {
                Err(stt::SttError::Retryable(503))
            } else {
                Ok("Answer".into())
            }
        }
    }
    async fn transcribe_stream(
        &self,
        _chunks: stt::AudioChunkStream,
        _keyterms: stt::Keyterms<'_>,
        _cancel: tokio_util::sync::CancellationToken,
    ) -> Result<String, stt::SttError> {
        unreachable!()
    }
    async fn warm_up(&self) {}
}

fn engine(fail: bool) -> Arc<Engine> {
    Arc::new(Engine {
        system_calls: AtomicUsize::new(0),
        microphone_calls: AtomicUsize::new(0),
        fail_microphone: AtomicBool::new(fail),
        panic_microphone: AtomicBool::new(false),
    })
}

fn recording(microphone: bool) -> RecordedAudio {
    let mut tracks = vec![RecordedTrack::new(AudioSource::System, vec![0.2; 16000])];
    if microphone {
        tracks.push(RecordedTrack::new(
            AudioSource::Microphone,
            vec![-0.2; 16000],
        ));
    }
    RecordedAudio {
        tracks,
        separated: microphone,
        keyterms: Vec::new(),
    }
}

#[tokio::test]
async fn tracks_keep_their_source_and_are_delivered_together() {
    let result = recording(true)
        .recognize(engine(false), Vec::new())
        .await
        .unwrap();
    assert!(result.separated);
    assert_eq!(
        result.segments,
        vec![
            TranscriptSegment {
                source: AudioSource::System,
                text: "Question".into()
            },
            TranscriptSegment {
                source: AudioSource::Microphone,
                text: "Answer".into()
            },
        ]
    );
}

#[tokio::test]
async fn retry_keeps_success_and_only_resubmits_the_failed_source() {
    let engine = engine(true);
    let recording = recording(true);
    assert!(recording
        .recognize(engine.clone(), Vec::new())
        .await
        .is_err());
    let result = recording
        .recognize(engine.clone(), Vec::new())
        .await
        .unwrap();
    assert_eq!(result.segments.len(), 2);
    assert_eq!(engine.system_calls.load(Ordering::SeqCst), 1);
    assert_eq!(engine.microphone_calls.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn a_provider_panic_does_not_abort_the_other_source_or_resubmit_it_on_retry() {
    let engine = engine(false);
    engine.panic_microphone.store(true, Ordering::SeqCst);
    let recording = recording(true);
    let error = recording
        .recognize(engine.clone(), Vec::new())
        .await
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::Retryable);
    let result = recording
        .recognize(engine.clone(), Vec::new())
        .await
        .unwrap();
    assert_eq!(result.segments.len(), 2);
    assert_eq!(engine.system_calls.load(Ordering::SeqCst), 1);
    assert_eq!(engine.microphone_calls.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn system_only_never_sends_a_microphone_request() {
    let engine = engine(false);
    let result = recording(false)
        .recognize(engine.clone(), Vec::new())
        .await
        .unwrap();
    assert!(!result.separated);
    assert_eq!(engine.microphone_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a_silent_source_is_not_sent_and_does_not_hide_the_other_voice() {
    let engine = engine(false);
    let mut recording = recording(true);
    recording.tracks[0] = RecordedTrack::new(AudioSource::System, vec![0.0; 16000]);
    let result = recording
        .recognize(engine.clone(), Vec::new())
        .await
        .unwrap();
    assert_eq!(
        result.segments,
        vec![TranscriptSegment {
            source: AudioSource::Microphone,
            text: "Answer".into()
        }]
    );
    assert_eq!(engine.system_calls.load(Ordering::SeqCst), 0);
}
