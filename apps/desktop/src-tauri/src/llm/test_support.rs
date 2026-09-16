//! Fixtures the LLM test modules share: a sink that keeps the streamed text,
//! one that drops it, and `ChatMessage` builders. Test-only; the smoke
//! examples keep their own sinks because `cfg(test)` does not reach them.
use super::{ChatMessage, ImageAttachment, LlmStreamSink};

/// Collects every text delta so a test can assert on the whole answer.
#[derive(Default)]
pub(crate) struct CollectingSink {
    pub text: String,
}

impl LlmStreamSink for CollectingSink {
    fn text_delta(&mut self, delta: &str) {
        self.text.push_str(delta);
    }
}

/// For tests that care about routing or errors, not about the text.
pub(crate) struct NoopSink;

impl LlmStreamSink for NoopSink {
    fn text_delta(&mut self, _delta: &str) {}
}

pub(crate) fn user(text: &str) -> ChatMessage {
    message("user", text, Vec::new())
}

pub(crate) fn assistant(text: &str) -> ChatMessage {
    message("assistant", text, Vec::new())
}

pub(crate) fn user_with_images(text: &str, images: Vec<ImageAttachment>) -> ChatMessage {
    message("user", text, images)
}

pub(crate) fn image(media_type: &str, data: &str) -> ImageAttachment {
    ImageAttachment {
        media_type: media_type.into(),
        data: data.into(),
    }
}

fn message(role: &str, text: &str, images: Vec<ImageAttachment>) -> ChatMessage {
    ChatMessage {
        role: role.into(),
        text: text.into(),
        images,
    }
}
