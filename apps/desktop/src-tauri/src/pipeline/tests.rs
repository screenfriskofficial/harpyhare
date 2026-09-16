use super::*;
use crate::llm::test_support::{image, user_with_images};
use crate::llm::{LlmError, ModelInfo};

#[test]
fn cancellation_before_registration_blocks_that_run_only() {
    let mut registry = RunRegistry::default();
    registry.cancel("cancelled");
    for node in ["first", "next"] {
        assert_eq!(
            registry.begin("cancelled", node).unwrap_err().code,
            ErrorCode::Cancelled
        );
    }
    assert!(!registry.begin("other", "first").unwrap().is_cancelled());
}

#[test]
fn cancellation_reaches_siblings_and_survives_their_cleanup() {
    let mut registry = RunRegistry::default();
    let first = registry.begin("run", "first").unwrap();
    let second = registry.begin("run", "second").unwrap();
    let other = registry.begin("other", "first").unwrap();
    registry.cancel("run");
    assert!(first.is_cancelled() && second.is_cancelled());
    assert!(!other.is_cancelled());
    registry.finish("run", "first");
    registry.finish("run", "second");
    assert!(!registry.active.contains_key("run"));
    assert_eq!(
        registry.begin("run", "later").unwrap_err().code,
        ErrorCode::Cancelled
    );
}

#[test]
fn completing_a_step_releases_it_without_cancelling_its_sibling() {
    let mut registry = RunRegistry::default();
    let first = registry.begin("run", "first").unwrap();
    let second = registry.begin("run", "second").unwrap();
    assert_eq!(
        registry.begin("run", "first").unwrap_err().code,
        ErrorCode::Internal
    );
    first.cancel();
    registry.finish("run", "first");
    assert!(!second.is_cancelled());
    registry.finish("run", "second");
    assert!(registry.active.is_empty());
    assert!(!registry.begin("run", "next").unwrap().is_cancelled());
}

#[test]
fn cancellation_history_is_bounded_without_reviving_active_runs() {
    let mut registry = RunRegistry::default();
    registry.begin("active", "first").unwrap();
    registry.cancel("active");
    for index in 0..CANCELLED_RUN_LIMIT + 1 {
        registry.cancel(&format!("old-{index}"));
    }
    assert_eq!(registry.cancelled.len(), CANCELLED_RUN_LIMIT);
    assert_eq!(
        registry.begin("active", "second").unwrap_err().code,
        ErrorCode::Cancelled
    );
    registry.cancel("latest");
    registry.cancel("latest");
    assert_eq!(
        registry
            .cancelled
            .iter()
            .filter(|id| *id == "latest")
            .count(),
        1
    );
}

#[test]
fn active_run_limits_do_not_cancel_existing_requests() {
    let mut registry = RunRegistry::default();
    let tokens = (0..MAX_ACTIVE_RUNS)
        .map(|index| registry.begin(&format!("run-{index}"), "step").unwrap())
        .collect::<Vec<_>>();
    assert_eq!(
        registry.begin("overflow", "step").unwrap_err().code,
        ErrorCode::Internal
    );
    assert!(tokens.iter().all(|token| !token.is_cancelled()));
    registry.finish("run-0", "step");
    assert!(registry.begin("overflow", "step").is_ok());
}

enum Outcome {
    Complete(&'static str),
    PartialFailure,
    CancelAtCompletion,
}

struct TestProvider {
    outcome: Outcome,
    received: Mutex<Option<LlmRequest>>,
}

#[async_trait::async_trait]
impl LlmProvider for TestProvider {
    fn provider_id(&self) -> &'static str {
        "test"
    }
    fn known_models(&self) -> Vec<ModelInfo> {
        Vec::new()
    }
    async fn stream(
        &self,
        request: LlmRequest,
        cancel: CancellationToken,
        sink: &mut dyn LlmStreamSink,
    ) -> Result<(), LlmError> {
        *self.received.lock_unpoisoned() = Some(request);
        match self.outcome {
            Outcome::Complete(text) => {
                sink.text_delta(text);
                Ok(())
            }
            Outcome::PartialFailure => {
                sink.text_delta("partial");
                Err(LlmError::Network("stream cut short".into()))
            }
            Outcome::CancelAtCompletion => {
                sink.text_delta("finished as Stop arrived");
                cancel.cancel();
                Ok(())
            }
        }
    }
    async fn list_models(&self) -> Result<Vec<ModelInfo>, LlmError> {
        Ok(Vec::new())
    }
    async fn reachable(&self) -> bool {
        true
    }
    async fn warm_up(&self) {}
}

fn provider(outcome: Outcome) -> TestProvider {
    TestProvider {
        outcome,
        received: Mutex::new(None),
    }
}

fn request() -> LlmRequest {
    LlmRequest {
        model: "selected-model".into(),
        system: "step instructions".into(),
        messages: vec![user_with_images(
            "step input",
            vec![image("image/png", "image-bytes")],
        )],
        options: RequestOptions {
            thinking: true,
            web_search: false,
        },
    }
}

#[tokio::test]
async fn complete_step_preserves_request_and_returns_successful_text() {
    let provider = provider(Outcome::Complete(" complete text\n"));
    assert_eq!(
        complete_step(&provider, request(), CancellationToken::new(), None)
            .await
            .unwrap(),
        " complete text\n"
    );
    let received = provider.received.lock_unpoisoned();
    let received = received.as_ref().unwrap();
    assert_eq!(received.model, "selected-model");
    assert_eq!(received.system, "step instructions");
    assert_eq!(received.messages[0].text, "step input");
    assert_eq!(received.messages[0].images[0].data, "image-bytes");
    assert!(received.options.thinking);
}

#[tokio::test]
async fn partial_text_is_discarded_after_stream_failure() {
    let error = complete_step(
        &provider(Outcome::PartialFailure),
        request(),
        CancellationToken::new(),
        None,
    )
    .await
    .unwrap_err();
    assert_eq!(error.code, ErrorCode::Network);
}

#[tokio::test]
async fn empty_or_cancelled_completion_never_becomes_step_result() {
    let error = complete_step(
        &provider(Outcome::Complete(" \n")),
        request(),
        CancellationToken::new(),
        None,
    )
    .await
    .unwrap_err();
    assert_eq!(error.code, ErrorCode::Api);
    let error = complete_step(
        &provider(Outcome::CancelAtCompletion),
        request(),
        CancellationToken::new(),
        None,
    )
    .await
    .unwrap_err();
    assert_eq!(error.code, ErrorCode::Cancelled);
}

#[tokio::test]
async fn precancelled_step_never_calls_provider() {
    let provider = provider(Outcome::Complete("answer"));
    let cancel = CancellationToken::new();
    cancel.cancel();
    assert_eq!(
        complete_step(&provider, request(), cancel, None)
            .await
            .unwrap_err()
            .code,
        ErrorCode::Cancelled
    );
    assert!(provider.received.lock_unpoisoned().is_none());
}
