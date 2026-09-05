//! Source-labelled recognition. Audio never crosses between source tracks;
//! successes are cached so retrying one failed channel cannot duplicate text.
use super::{settle_stream, StreamVerdict};
use crate::app_state::SttStream;
use crate::error::{AppError, ErrorCode};
use crate::sync::LockUnpoisoned;
use crate::{audio, stt};
use std::sync::{Arc, Mutex};

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum AudioSource {
    System,
    Microphone,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, specta::Type)]
pub struct TranscriptSegment {
    pub source: AudioSource,
    pub text: String,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, specta::Type)]
pub struct TranscriptReady {
    pub segments: Vec<TranscriptSegment>,
    pub separated: bool,
}

pub struct RecordedTrack {
    pub source: AudioSource,
    pub samples: Arc<[f32]>,
    text: Mutex<Option<String>>,
}

impl RecordedTrack {
    pub fn new(source: AudioSource, samples: Vec<f32>) -> Self {
        Self {
            source,
            samples: samples.into(),
            text: Mutex::new(None),
        }
    }
}

pub struct RecordedAudio {
    pub tracks: Vec<RecordedTrack>,
    pub separated: bool,
    pub keyterms: Vec<String>,
}

impl RecordedAudio {
    pub async fn recognize(
        &self,
        engine: Arc<dyn stt::SttEngine>,
        mut streams: Vec<(AudioSource, SttStream)>,
    ) -> Result<TranscriptReady, AppError> {
        let jobs = self
            .tracks
            .iter()
            .map(|track| {
                let stream = streams
                    .iter()
                    .position(|(source, _)| *source == track.source)
                    .map(|index| streams.remove(index).1);
                // Isolate provider panics per track, just like normal errors:
                // a failed source must not abort its still-running sibling.
                super::supervise_transcription(recognize_track(
                    track,
                    Arc::clone(&engine),
                    &self.keyterms,
                    stream,
                ))
            })
            .collect::<Vec<_>>();
        // Await both even if one fails: a successful sibling is kept for retry.
        let results = futures_util::future::join_all(jobs).await;
        let segments = results
            .into_iter()
            .map(|result| result.and_then(std::convert::identity))
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .filter(|s| !s.text.trim().is_empty())
            .collect::<Vec<_>>();
        if segments.is_empty() {
            return Err(AppError::new(ErrorCode::Silence, super::ERR_NO_SPEECH));
        }
        Ok(TranscriptReady {
            segments,
            separated: self.separated,
        })
    }
}

async fn recognize_track(
    track: &RecordedTrack,
    engine: Arc<dyn stt::SttEngine>,
    keyterms: &[String],
    stream: Option<SttStream>,
) -> Result<TranscriptSegment, AppError> {
    let cached = track.text.lock_unpoisoned().clone();
    let text = if let Some(text) = cached {
        text
    } else {
        let text = if audio::is_silence(&track.samples) {
            if let Some(stream) = stream {
                stream.cancel.cancel();
            }
            String::new()
        } else {
            let outcome = if let Some(stream) = stream {
                match settle_stream(stream).await {
                    StreamVerdict::Deliver(text) => Ok(text),
                    StreamVerdict::Fail(error) => Err(error),
                    StreamVerdict::FallBack => engine.transcribe(&track.samples, keyterms).await,
                }
            } else {
                engine.transcribe(&track.samples, keyterms).await
            };
            outcome.map_err(|e| AppError::from(&e))?.trim().to_string()
        };
        *track.text.lock_unpoisoned() = Some(text.clone());
        text
    };
    Ok(TranscriptSegment {
        source: track.source,
        text,
    })
}

#[cfg(test)]
mod tests;
