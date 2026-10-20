//! Speech-to-text: the port, the vendor registry and the one factory.
//!
//! Adding a vendor that speaks a known protocol is a row in `registry`; a new
//! protocol is a transport beside `deepgram` and an arm in `build_engine`. See
//! «Как добавить нового STT-вендора» in `apps/desktop/CLAUDE.md`.

use std::sync::Arc;

/// Deepgram говорит не на multipart-диалекте: батч — сырой WAV телом, а
/// низколатентный путь вообще WebSocket. Поэтому это транспорт, реализующий
/// порт `SttEngine`, а не набор значений в общем клиенте.
pub mod deepgram;
/// The one table a vendor is declared in; its picker half is exported to the
/// frontend, its transport half deliberately is not.
pub mod registry;

#[derive(Debug, thiserror::Error)]
pub enum SttError {
    #[error(transparent)]
    Http(#[from] crate::error::http::HttpFailure),
    #[error("Неверный ключ {0} — проверь в настройках")]
    BadApiKey(&'static str),
    #[error("Сервис распознавания перегружен, попробуй позже ({0})")]
    Retryable(u16),
    #[error("Нет соединения — проверь интернет/VPN: {0}")]
    Network(String),
    #[error("Остановлено")]
    Cancelled,
    #[error("{0}")]
    Other(String),
}

impl crate::error::CodedError for SttError {
    fn code(&self) -> crate::error::ErrorCode {
        use crate::error::ErrorCode;
        match self {
            SttError::Http(error) => error.code,
            SttError::BadApiKey(_) => ErrorCode::BadApiKey,
            SttError::Retryable(status) => {
                crate::error::http::classify(*status, &serde_json::Value::Null)
            }
            SttError::Network(_) => ErrorCode::Network,
            SttError::Cancelled => ErrorCode::Cancelled,
            SttError::Other(_) => ErrorCode::Api,
        }
    }
}

impl crate::error::http::ProviderError for SttError {
    fn bad_api_key(key_label: &'static str) -> Self {
        SttError::BadApiKey(key_label)
    }
    fn api(message: String) -> Self {
        SttError::Other(message)
    }
    fn retryable(status: u16) -> Self {
        SttError::Retryable(status)
    }
    fn http(failure: crate::error::http::HttpFailure) -> Self {
        SttError::Http(failure)
    }
    fn network(message: String) -> Self {
        SttError::Network(message)
    }
}

/// Сырой PCM: 16 кГц, моно, 16-бит LE — без контейнера. Что нужно вендору
/// поверх (WAV-заголовок, ничего), добавляет его транспорт, а не конвейер.
pub type AudioChunkStream =
    std::pin::Pin<Box<dyn futures_util::Stream<Item = Result<Vec<u8>, std::io::Error>> + Send>>;

/// Terms the chat declared through `[keywords]: [...]`, passed per request
/// rather than baked into the client: they change with the active chat, and
/// rebuilding the client on every switch would throw away its warm connection
/// pool — the thing that keeps "released the key → text" fast.
pub type Keyterms<'a> = &'a [String];

#[async_trait::async_trait]
pub trait SttEngine: Send + Sync {
    async fn transcribe(
        &self,
        samples_16k_mono: &[f32],
        keyterms: Keyterms<'_>,
    ) -> Result<String, SttError>;
    async fn transcribe_stream(
        &self,
        chunks: AudioChunkStream,
        keyterms: Keyterms<'_>,
        cancel: tokio_util::sync::CancellationToken,
    ) -> Result<String, SttError>;
    async fn warm_up(&self);
}

/// Everything a vendor engine is built from, besides its registry row.
#[derive(Clone, PartialEq)]
pub struct SttClientConfig {
    pub api_key: String,
    pub language: String,
}

impl std::fmt::Debug for SttClientConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SttClientConfig")
            .field(
                "api_key",
                &format_args!("<{} симв.>", self.api_key.chars().count()),
            )
            .field("language", &self.language)
            .finish()
    }
}

/// The shared transport policy in this port's terms — see `error::http::transport_error`.
fn network_error(e: reqwest::Error) -> SttError {
    crate::error::http::transport_error(&e)
}

/// **Единственная точка сборки движка по строке реестра.** Диалект решает,
/// какой транспорт обслуживает строку. Приложение (`build_stt_client`) и смоук
/// (`examples/stt_smoke.rs`) идут через неё же, поэтому вендор, добавленный
/// в реестр, обслуживается везде без правок.
pub fn build_engine(
    spec: &'static registry::SttProviderSpec,
    config: SttClientConfig,
) -> Arc<dyn SttEngine> {
    match spec.wire {
        registry::SttWire::Deepgram { .. } => Arc::new(
            deepgram::DeepgramStt::from_spec(spec, config.api_key).with_language(config.language),
        ),
    }
}
