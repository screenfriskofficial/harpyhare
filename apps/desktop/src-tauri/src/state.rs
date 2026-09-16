pub const MIN_RECORDING_SECS: f32 = 0.3;
pub const MAX_RECORDING_SECS: f32 = 600.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum RecorderState {
    Idle,
    Recording,
    Transcribing,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Event {
    PttPressed,
    PttReleased { duration_secs: f32 },
    Cancel,
    MaxDurationReached,
    TranscriptionFinished,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    None,
    StartCapture,
    Transcribe,
    Discard,
}

impl RecorderState {
    pub fn on(&mut self, e: Event) -> Action {
        use Action as A;
        use Event as E;
        use RecorderState as S;
        let (next, action) = match (*self, e) {
            (S::Idle, E::PttPressed) => (S::Recording, A::StartCapture),
            (S::Recording, E::PttReleased { duration_secs })
                if duration_secs < MIN_RECORDING_SECS =>
            {
                (S::Idle, A::Discard)
            }
            (S::Recording, E::PttReleased { .. }) => (S::Transcribing, A::Transcribe),
            (S::Recording, E::MaxDurationReached) => (S::Transcribing, A::Transcribe),
            (S::Recording, E::Cancel) => (S::Idle, A::Discard),
            (S::Transcribing, E::TranscriptionFinished) => (S::Idle, A::None),
            (s, _) => (s, A::None),
        };
        *self = next;
        action
    }
}

#[cfg(test)]
mod tests;
