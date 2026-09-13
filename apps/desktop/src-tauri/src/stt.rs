//! Speech-to-text: one HTTP client for every vendor.
//!
//! Adding a vendor is a row in `registry` and nothing else — the client reads
//! those fields instead of branching. See «Как добавить нового STT-вендора» in
//! `apps/desktop/CLAUDE.md`.

use crate::audio;

/// The one table a vendor is declared in; its picker half is exported to the
/// frontend, its transport half deliberately is not.
/// Deepgram говорит не на общем multipart-диалекте: батч — сырой WAV телом,
/// а низколатентный путь вообще WebSocket. Поэтому у него свой транспорт,
/// реализующий тот же порт `SttEngine`, а не ветка в общем клиенте.
pub mod deepgram;
pub mod registry;

const DEFAULT_LANGUAGE: &str = "ru";

const WAV_MIME: &str = "audio/wav";
const WAV_FILE_NAME: &str = "audio.wav";
const CANCELLED_MESSAGE: &str = "отменено";

const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);
const HTTP2_KEEP_ALIVE_INTERVAL: std::time::Duration = std::time::Duration::from_secs(30);
const HTTP2_KEEP_ALIVE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);
const DEFAULT_REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);
const WARM_UP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);
const STREAM_REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(11 * 60);

#[derive(Debug, thiserror::Error)]
pub enum SttError {
    #[error("Неверный ключ {0} — проверь в настройках")]
    BadApiKey(&'static str),
    #[error("{0}")]
    BadAccessCode(String),
    #[error("Сервис распознавания перегружен, попробуй позже ({0})")]
    Retryable(u16),
    #[error("Нет соединения — проверь интернет/VPN: {0}")]
    Network(String),
    #[error("{0}")]
    Other(String),
}

impl crate::error::CodedError for SttError {
    fn code(&self) -> crate::error::ErrorCode {
        use crate::error::ErrorCode;
        match self {
            SttError::BadApiKey(_) => ErrorCode::BadApiKey,
            SttError::BadAccessCode(_) => ErrorCode::BadAccessCode,
            SttError::Retryable(_) => ErrorCode::Retryable,
            SttError::Network(_) => ErrorCode::Network,
            SttError::Other(_) => ErrorCode::Api,
        }
    }
}

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

/// One client for every vendor: they all speak the same multipart dialect, and
/// what separates them is a row in `registry`, not a branch in here.
#[derive(Clone)]
pub struct SttHttpClient {
    spec: &'static registry::SttProviderSpec,
    api_key: String,
    base_url: String,
    timeout: std::time::Duration,
    client: reqwest::Client,
    language: String,
    translate: bool,
    proxy: bool,
}

pub(crate) fn warm_pooled_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(crate::llm::APP_USER_AGENT)
        .connect_timeout(CONNECT_TIMEOUT)
        .pool_idle_timeout(None)
        .http2_keep_alive_interval(HTTP2_KEEP_ALIVE_INTERVAL)
        .http2_keep_alive_timeout(HTTP2_KEEP_ALIVE_TIMEOUT)
        .http2_keep_alive_while_idle(true)
        .build()
        .expect("reqwest client")
}

impl SttHttpClient {
    /// The only constructor. An id the registry does not know resolves to the
    /// default vendor rather than failing — the same rule `Settings::clamp`
    /// applies to the stored value.
    pub fn for_provider(provider_id: &str, api_key: String) -> Self {
        debug_assert!(
            !matches!(
                registry::resolve(provider_id).wire,
                registry::SttWire::Deepgram { .. }
            ),
            "у Deepgram свой транспорт — общий multipart-клиент его не обслуживает",
        );
        Self::over(registry::resolve(provider_id), api_key)
    }

    fn over(spec: &'static registry::SttProviderSpec, api_key: String) -> Self {
        Self {
            spec,
            api_key,
            base_url: spec.wire.base_url().into(),
            timeout: DEFAULT_REQUEST_TIMEOUT,
            client: warm_pooled_client(),
            language: DEFAULT_LANGUAGE.into(),
            translate: false,
            proxy: false,
        }
    }

    pub fn with_base_url(mut self, url: String) -> Self {
        self.base_url = url;
        self
    }
    pub fn with_timeout(mut self, t: std::time::Duration) -> Self {
        self.timeout = t;
        self
    }
    pub fn with_language(mut self, language: String) -> Self {
        self.language = language;
        self
    }
    /// Stored as asked; `translate()` is what the request actually uses.
    pub fn with_translate(mut self, translate: bool) -> Self {
        self.translate = translate;
        self
    }

    /// Translation only where the vendor offers it — see `registry`.
    fn translate(&self) -> bool {
        registry::effective_translate(self.spec, self.translate)
    }
    pub fn with_proxy(mut self, proxy: bool) -> Self {
        self.proxy = proxy;
        self
    }
}

impl SttHttpClient {
    /// No language field when translating (the model decides) or when the user
    /// asked for autodetect.
    fn language_field(&self) -> Option<String> {
        if self.translate() || self.language.is_empty() {
            None
        } else {
            Some(self.language.clone())
        }
    }

    /// Adds whatever terms this vendor accepts, in the shape it accepts them.
    fn with_keyterms(
        &self,
        form: reqwest::multipart::Form,
        keyterms: Keyterms<'_>,
    ) -> reqwest::multipart::Form {
        let accepted = self.spec.keyterms.accepted(keyterms);
        if accepted.is_empty() {
            return form;
        }
        match self.spec.keyterms {
            registry::SttKeyterms::Unsupported => form,
            registry::SttKeyterms::Repeated { field, .. } => accepted
                .iter()
                .fold(form, |acc, term| acc.text(field, term.clone())),
            registry::SttKeyterms::Prompt { field } => form.text(field, accepted.join(", ")),
        }
    }

    fn form_with(
        &self,
        part: reqwest::multipart::Part,
        keyterms: Keyterms<'_>,
    ) -> reqwest::multipart::Form {
        let file = part.file_name(WAV_FILE_NAME);
        match self.spec.wire {
            registry::SttWire::OpenAiMultipart {
                transcribe_model,
                translate_model,
                temperature,
                ..
            } => {
                let model = if self.translate() {
                    translate_model
                } else {
                    transcribe_model
                };
                let mut form = reqwest::multipart::Form::new()
                    .part("file", file)
                    .text("model", model)
                    .text("response_format", "json");
                if let Some(temperature) = temperature {
                    form = form.text("temperature", temperature);
                }
                let form = match self.language_field() {
                    Some(language) => form.text("language", language),
                    None => form,
                };
                self.with_keyterms(form, keyterms)
            }
            // The audio part goes LAST here: xAI rejects a body that leads with
            // it. There is no model to pick and no translations endpoint.
            registry::SttWire::Xai { .. } => {
                let form = reqwest::multipart::Form::new();
                let form = match self.language_field() {
                    Some(language) => form.text("language", language),
                    None => form,
                };
                // The audio part must stay last, so keyterms go in before it.
                self.with_keyterms(form, keyterms).part("file", file)
            }
            // Недостижимо: `for_provider` разворачивает Deepgram в собственный
            // транспорт ещё до конструктора. Ветка оставлена явной, чтобы новый
            // диалект нельзя было добавить, забыв про этот клиент.
            registry::SttWire::Deepgram { .. } => {
                unreachable!("у Deepgram свой транспорт, см. stt::deepgram")
            }
        }
    }

    fn request_with(
        &self,
        part: reqwest::multipart::Part,
        keyterms: Keyterms<'_>,
        timeout: std::time::Duration,
    ) -> reqwest::RequestBuilder {
        self.client
            .post(format!(
                "{}{}",
                self.base_url,
                self.spec.wire.path(self.translate())
            ))
            .bearer_auth(&self.api_key)
            .multipart(self.form_with(part, keyterms))
            .timeout(timeout)
    }

    async fn parse_response(&self, resp: reqwest::Response) -> Result<String, SttError> {
        crate::diagnostics::observe_response(resp.status().as_u16(), resp.headers());
        match resp.status().as_u16() {
            200 => Self::text_from_success(resp).await,
            _ => {
                let (code, body, message) = crate::error::http::read_body(resp).await;
                match crate::error::http::classify(code, &body, self.proxy) {
                    crate::error::http::HttpClass::BadAccessCode => {
                        Err(SttError::BadAccessCode(message))
                    }
                    crate::error::http::HttpClass::BadApiKey => {
                        Err(SttError::BadApiKey(self.spec.key_label))
                    }
                    crate::error::http::HttpClass::Retryable => Err(SttError::Retryable(code)),
                    crate::error::http::HttpClass::Api => Err(SttError::Other(message)),
                }
            }
        }
    }

    async fn text_from_success(resp: reqwest::Response) -> Result<String, SttError> {
        let v: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| SttError::Other(e.to_string()))?;
        Ok(v["text"]
            .as_str()
            .ok_or_else(|| SttError::Other("ответ распознавания без поля text".into()))?
            .trim()
            .to_string())
    }
}

#[async_trait::async_trait]
impl SttEngine for SttHttpClient {
    async fn transcribe_stream(
        &self,
        chunks: AudioChunkStream,
        keyterms: Keyterms<'_>,
        cancel: tokio_util::sync::CancellationToken,
    ) -> Result<String, SttError> {
        let part = reqwest::multipart::Part::stream(reqwest::Body::wrap_stream(chunks))
            .mime_str(WAV_MIME)
            .map_err(|e| SttError::Other(e.to_string()))?;
        let send = self
            .request_with(part, keyterms, STREAM_REQUEST_TIMEOUT)
            .send();
        let resp = tokio::select! {
            r = send => r.map_err(|e| SttError::Network(e.to_string()))?,
            _ = cancel.cancelled() => return Err(SttError::Other(CANCELLED_MESSAGE.into())),
        };
        self.parse_response(resp).await
    }

    async fn warm_up(&self) {
        let _ = self
            .client
            .get(format!(
                "{}{}",
                self.base_url,
                self.spec.wire.warm_up_path()
            ))
            .timeout(WARM_UP_TIMEOUT)
            .send()
            .await;
    }

    async fn transcribe(
        &self,
        samples: &[f32],
        keyterms: Keyterms<'_>,
    ) -> Result<String, SttError> {
        let wav =
            audio::encode_wav_16k_mono(samples).map_err(|e| SttError::Other(e.to_string()))?;
        let part = reqwest::multipart::Part::bytes(wav)
            .mime_str(WAV_MIME)
            .map_err(|e| SttError::Other(e.to_string()))?;
        let resp = self
            .request_with(part, keyterms, self.timeout)
            .send()
            .await
            .map_err(|e| SttError::Network(e.to_string()))?;
        self.parse_response(resp).await
    }
}

#[cfg(test)]
mod tests;
