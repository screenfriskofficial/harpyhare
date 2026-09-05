use super::*;

#[test]
fn a_bad_credential_from_the_stream_is_final_and_skips_the_batch_fallback() {
    assert!(matches!(
        stream_verdict(Err(stt::SttError::BadApiKey("Groq"))),
        StreamVerdict::Fail(stt::SttError::BadApiKey("Groq"))
    ));
    assert!(matches!(
        stream_verdict(Err(stt::SttError::BadAccessCode("код мёртв".into()))),
        StreamVerdict::Fail(_)
    ));
}

#[test]
fn any_other_stream_failure_falls_back_to_the_batch_upload() {
    for err in [
        stt::SttError::Network("сеть".into()),
        stt::SttError::Retryable(503),
        stt::SttError::Other("что-то".into()),
        stt::SttError::Cancelled,
    ] {
        assert!(matches!(stream_verdict(Err(err)), StreamVerdict::FallBack));
    }
}

#[test]
fn a_successful_stream_is_delivered_as_is() {
    assert!(matches!(stream_verdict(Ok("текст".into())), StreamVerdict::Deliver(t) if t == "текст"));
}

#[test]
fn chunks_are_coalesced_and_the_tail_is_flushed_on_drop() {
    let (tx, mut rx) = tokio::sync::mpsc::channel::<SttBodyChunk>(8);
    let broken = Arc::new(AtomicBool::new(false));
    let mut coalescer = ChunkCoalescer { pending: Vec::new(), tx, broken: Arc::clone(&broken) };
    let frame = vec![0.1f32; 341];
    for _ in 0..4 {
        coalescer.push(&frame);
    }
    assert!(rx.try_recv().is_err(), "4 кадра по 682 байта не дотягивают до порога");
    coalescer.push(&frame);
    let first = rx.try_recv().expect("пятый кадр перевалил порог").unwrap();
    assert_eq!(first.len(), 341 * 2 * 5);
    coalescer.push(&frame);
    drop(coalescer);
    let tail = rx.try_recv().expect("хвост уходит в Drop").unwrap();
    assert_eq!(tail.len(), 341 * 2);
    assert!(!broken.load(Ordering::Relaxed));
}

#[test]
fn a_full_channel_marks_the_stream_broken_instead_of_blocking() {
    let (tx, _rx) = tokio::sync::mpsc::channel::<SttBodyChunk>(1);
    let broken = Arc::new(AtomicBool::new(false));
    let mut coalescer = ChunkCoalescer { pending: Vec::new(), tx, broken: Arc::clone(&broken) };
    let big = vec![0.1f32; STT_CHUNK_TARGET_BYTES];
    coalescer.push(&big);
    assert!(!broken.load(Ordering::Relaxed), "первый чанк влез в канал");
    coalescer.push(&big);
    assert!(broken.load(Ordering::Relaxed), "второй не влез — стрим помечен неполным");
}

#[tokio::test]
async fn transcription_supervision_catches_panics_after_suspension() {
    let outcome = supervise_transcription(async {
        tokio::task::yield_now().await;
        panic!("provider panic during retry");
    }).await;
    assert_eq!(outcome, Err(AppError::new(ErrorCode::Internal, ERR_TRANSCRIPTION_CRASHED)));
    assert_eq!(supervise_transcription(async {}).await, Ok(()));
}
