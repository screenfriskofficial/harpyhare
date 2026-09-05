use super::*;
use std::sync::mpsc;

const SAMPLE_RATE: u32 = 16000;
const SETTLE: Duration = Duration::from_millis(60);

fn assemble(channels: usize, buffer_secs: u64) -> (AudioCapture, Box<CallbackCtx>) {
    AudioCapture::assemble(
        StreamSpec {
            sample_rate: SAMPLE_RATE,
            channels,
        },
        buffer_secs,
    )
    .expect("фасад собирается без бэкенда")
}

fn frames(channels: usize, count: usize, value: f32) -> Vec<f32> {
    vec![value; count * channels]
}

/// Бэкенд кладёт сэмплы в кольцо только при поднятом `recording`, а поднимает
/// его консьюмер в начале сессии — и первым делом сбрасывает всё, что лежало в
/// кольце до неё. Продюсер теста обязан дождаться того же флага.
fn wait_until_recording(capture: &AudioCapture) {
    let started = std::time::Instant::now();
    while !capture.shared.recording.load(Ordering::Acquire) {
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "консьюмер не начал сессию"
        );
        std::thread::sleep(Duration::from_millis(1));
    }
}

fn collecting_sink() -> (ChunkSink, mpsc::Receiver<Vec<f32>>) {
    let (tx, rx) = mpsc::channel();
    (
        Box::new(move |chunk: &[f32]| {
            let _ = tx.send(chunk.to_vec());
        }),
        rx,
    )
}

/// Продюсер и консьюмер живут в разных потоках, и «stop раньше, чем консьюмер
/// проснулся» — штатная гонка, которую протокол `Session` обязан выдерживать:
/// не зависнуть и вернуть пустую запись, а не ошибку.
#[test]
fn stop_before_the_consumer_wakes_returns_an_empty_recording() {
    let (mut capture, _ctx) = assemble(1, 1);
    capture.start(None).unwrap();
    let recorded = capture.stop().unwrap();
    assert!(recorded.is_empty());
}

#[test]
fn a_mono_16k_recording_passes_through_untouched() {
    let (mut capture, mut ctx) = assemble(1, 1);
    capture.start(None).unwrap();
    wait_until_recording(&capture);
    ctx.push_samples(&frames(1, 800, 0.25));
    let recorded = capture.stop().unwrap();
    assert_eq!(
        recorded.len(),
        800,
        "16 кГц моно проходит без ресемплинга и без потерь"
    );
    assert!(recorded.iter().all(|s| (*s - 0.25).abs() < f32::EPSILON));
}

#[test]
fn finishing_a_one_shot_source_drains_audio_closes_the_sink_and_releases_the_consumer() {
    let (mut capture, mut ctx) = assemble(1, 0);
    let shared = Arc::downgrade(&capture.shared);
    let (sink, rx) = collecting_sink();
    capture.start(Some(sink)).unwrap();
    wait_until_recording(&capture);
    let audio = frames(1, 800, 0.25);
    ctx.push_samples(&audio);
    drop(ctx);

    let recorded = capture.finish().unwrap();
    assert_eq!(recorded, audio);
    let streamed: Vec<f32> = rx.try_iter().flatten().collect();
    assert_eq!(streamed, recorded);
    assert!(matches!(
        rx.try_recv(),
        Err(mpsc::TryRecvError::Disconnected)
    ));
    assert!(
        shared.upgrade().is_none(),
        "consumer must be joined before finish returns"
    );
}

#[test]
fn the_sink_sees_exactly_what_the_recording_returns() {
    let (mut capture, mut ctx) = assemble(2, 1);
    let (sink, rx) = collecting_sink();
    capture.start(Some(sink)).unwrap();
    wait_until_recording(&capture);
    ctx.push_samples(&frames(2, 400, 0.5));
    std::thread::sleep(SETTLE);
    ctx.push_samples(&frames(2, 400, 0.5));
    let recorded = capture.stop().unwrap();
    let streamed: Vec<f32> = rx.try_iter().flatten().collect();
    assert_eq!(recorded.len(), 800, "стерео даунмикшится в моно");
    assert_eq!(streamed, recorded);
}

#[test]
fn the_preroll_reaches_the_sink_before_any_live_chunk() {
    let (mut capture, mut ctx) = assemble(1, 1);
    capture.set_buffering(true);
    ctx.push_samples(&frames(1, 320, 0.1));
    std::thread::sleep(SETTLE);

    let (sink, rx) = collecting_sink();
    capture.start(Some(sink)).unwrap();
    wait_until_recording(&capture);
    std::thread::sleep(SETTLE);
    ctx.push_samples(&frames(1, 320, 0.9));
    let recorded = capture.stop().unwrap();

    let first = rx.recv().expect("первый чанк — снимок буфера");
    assert!(
        first.iter().all(|s| (*s - 0.1).abs() < f32::EPSILON),
        "преролл идёт первым"
    );
    assert_eq!(first.len(), 320);
    assert_eq!(recorded.len(), 640, "аккумулятор = преролл + живой звук");
    assert!(recorded[..320]
        .iter()
        .all(|s| (*s - 0.1).abs() < f32::EPSILON));
    assert!(recorded[320..]
        .iter()
        .all(|s| (*s - 0.9).abs() < f32::EPSILON));
}

#[test]
fn start_refuses_to_stack_a_session_on_a_running_one() {
    let (mut capture, _ctx) = assemble(1, 1);
    capture.start(None).unwrap();
    std::thread::sleep(SETTLE);
    assert!(matches!(capture.start(None), Err(CaptureError::Audio(_))));
    capture.stop().unwrap();
    assert!(
        capture.start(None).is_ok(),
        "после stop сессия снова доступна"
    );
    capture.stop().unwrap();
}

#[test]
fn a_dead_capture_refuses_to_start() {
    let (mut capture, ctx) = assemble(1, 1);
    ctx.shared.mark_dead();
    assert!(capture.is_dead());
    assert!(matches!(capture.start(None), Err(CaptureError::Backend(_))));
}

/// Кольцо переполнилось — сэмплы теряются, но раскладка каналов нет: в кольцо
/// попадают только целые кадры, иначе левый канал следующего кадра вставал бы
/// на место правого до конца сессии.
#[test]
fn overflow_drops_samples_by_whole_frames_only() {
    let channels = 2;
    let (capture, mut ctx) = assemble(channels, 1);
    // Кольцо на RING_SECONDS секунд; консьюмер в покое ничего не читает.
    let capacity = SAMPLE_RATE as usize * channels * RING_SECONDS;
    ctx.push_samples(&frames(channels, capacity / channels - 1, 0.0));
    ctx.push_samples(&[1.0, 1.0, 1.0]);
    let produced = capture.shared.produced.load(Ordering::Relaxed) as usize;
    assert_eq!(produced % channels, 0, "в кольце только целые кадры");
    assert_eq!(produced, capacity, "кольцо заполнено ровно до края");
    assert_eq!(capture.shared.dropped.load(Ordering::Relaxed), 1);
}

#[test]
fn dropping_the_capture_stops_the_consumer_thread() {
    let (capture, ctx) = assemble(1, 1);
    capture.set_buffering(true);
    let shared = Arc::clone(&capture.shared);
    assert_eq!(
        Arc::strong_count(&shared),
        4,
        "капчер, ctx, консьюмер и тест"
    );
    drop(capture);
    assert!(shared.shutting_down());
    assert_eq!(
        Arc::strong_count(&shared),
        2,
        "консьюмер вышел и отпустил Shared: остались ctx и тест"
    );
    drop(ctx);
}

#[test]
fn a_session_interrupted_by_shutdown_does_not_hang_stop() {
    let (mut capture, _ctx) = assemble(1, 1);
    capture.start(None).unwrap();
    std::thread::sleep(SETTLE);
    capture.shared.shutdown.store(true, Ordering::Release);
    let err = capture.stop().unwrap_err();
    assert!(matches!(err, CaptureError::Audio(m) if m.contains(SHUTDOWN_RESULT)));
}

#[test]
fn a_zero_channel_device_is_rejected_up_front() {
    assert!(AudioCapture::assemble(
        StreamSpec {
            sample_rate: SAMPLE_RATE,
            channels: 0
        },
        1
    )
    .is_err());
}
