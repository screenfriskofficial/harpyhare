use super::*;

#[test]
fn happy_path() {
    let mut m = RecorderState::Idle;
    assert_eq!(m.on(Event::PttPressed), Action::StartCapture);
    assert_eq!(m, RecorderState::Recording);
    assert_eq!(
        m.on(Event::PttReleased { duration_secs: 2.0 }),
        Action::Transcribe
    );
    assert_eq!(m, RecorderState::Transcribing);
    assert_eq!(m.on(Event::TranscriptionFinished), Action::None);
    assert_eq!(m, RecorderState::Idle);
}

#[test]
fn too_short_recording_is_discarded() {
    let mut m = RecorderState::Recording;
    assert_eq!(
        m.on(Event::PttReleased { duration_secs: 0.2 }),
        Action::Discard
    );
    assert_eq!(m, RecorderState::Idle);
}

#[test]
fn press_ignored_while_transcribing() {
    let mut m = RecorderState::Transcribing;
    assert_eq!(m.on(Event::PttPressed), Action::None);
    assert_eq!(m, RecorderState::Transcribing);
}

#[test]
fn esc_cancels_only_recording() {
    let mut m = RecorderState::Recording;
    assert_eq!(m.on(Event::Cancel), Action::Discard);
    assert_eq!(m, RecorderState::Idle);
    let mut idle = RecorderState::Idle;
    assert_eq!(idle.on(Event::Cancel), Action::None);
}

#[test]
fn max_duration_forces_transcription() {
    let mut m = RecorderState::Recording;
    assert_eq!(m.on(Event::MaxDurationReached), Action::Transcribe);
    assert_eq!(m, RecorderState::Transcribing);
}
