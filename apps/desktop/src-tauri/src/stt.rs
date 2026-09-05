//! Speech-to-text: the port, the shared multipart client and the one factory.
//!
//! Adding a vendor is a row in `registry` and nothing else — the client reads
//! those fields instead of branching. See «Как добавить нового STT-вендора» in
//! `apps/desktop/CLAUDE.md`.

use std::sync::Arc;

use crate::audio;

/// The one table a vendor is declared in; its picker half is exported to the
/// frontend, its transport half deliberately is not.
pub mod registry;
pub mod models;
/// Deepgram говорит не на общем multipart-диалекте: батч — сырой WAV телом,
/// а низколатентный путь вообще WebSocket. Поэтому у него свой транспорт,
/// реализующий тот же порт `SttEngine`, а не ветка в общем клиенте.
pub mod deepgram;

const DEFAULT_LANGUAGE: &str = "ru";

const WAV_MIME: &str = "audio/wav";
const WAV_FILE_NAME: &str = "audio.wav";

const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);
const HTTP2_KEEP_ALIVE_INTERVAL: std::time::Duration = std::time::Duration::from_secs(30);
const HTTP2_KEEP_ALIVE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);
/// База таймаута батчевой загрузки; к ней добавляется длительность самой
/// записи — десятиминутный WAV с инференсом в 60 с не укладывался.
const DEFAULT_REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);
const WARM_UP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);
const STREAM_REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(11 * 60);
/// HTTP-эквивалент «сервер не успел» для `SttError::Retryable`.
const TIMEOUT_STATUS: u16 = 408;

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
    #[error("Остановлено")]
    Cancelled,
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
            SttError::Cancelled => ErrorCode::Cancelled,
            SttError::Other(_) => ErrorCode::Api,
        }
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
    /// Only catalog-backed providers use an override. Fixed-model providers
    /// retain their own models when the user switches back to them.
    pub model: Option<String>,
    pub api_key: String,
    /// `Some` — ходить через relay с этим base_url и bearer'ом кода доступа.
    pub proxy_base_url: Option<String>,
    pub language: String,
    pub translate: bool,
}

impl std::fmt::Debug for SttClientConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SttClientConfig")
            .field("model", &self.model)
            .field("api_key", &format_args!("<{} симв.>", self.api_key.chars().count()))
            .field("proxy_base_url", &self.proxy_base_url)
            .field("language", &self.language)
            .field("translate", &self.translate)
            .finish()
    }
}

/// **Единственная точка сборки движка по строке реестра.** Диалект решает,
/// какой транспорт обслуживает строку: multipart-клиент для OpenAI-диалекта и
/// xAI, собственный — для Deepgram. Приложение (`build_stt_client`) и смоуки
/// (`examples/stt_smoke.rs`) идут через неё же, поэтому вендор, добавленный
/// в реестр, обслуживается везде без правок.
pub fn build_engine(spec: &'static registry::SttProviderSpec, config: SttClientConfig) -> Arc<dyn SttEngine> {
    match spec.wire {
        registry::SttWire::Deepgram { .. } => Arc::new(
            deepgram::DeepgramStt::from_spec(spec, config.api_key).with_language(config.language),
        ),
        registry::SttWire::OpenAiMultipart { .. } | registry::SttWire::Xai { .. } => {
            let mut client = SttHttpClient::over(spec, config.api_key);
            if spec.id == registry::PROVIDER_OPENROUTER {
                client.model = config.model.filter(|model| !model.trim().is_empty());
            }
            let client = match config.proxy_base_url {
                Some(url) => client.with_base_url(url).with_proxy(true),
                None => client,
            };
            Arc::new(client.with_language(config.language).with_translate(config.translate))
        }
    }
}

/// One client for every multipart vendor: they all speak the same dialect, and
/// what separates them is a row in `registry`, not a branch in here.
#[derive(Clone)]
pub struct SttHttpClient {
    model: Option<String>,
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
    crate::tls::ensure_crypto_provider();
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

/// Сетевая ошибка reqwest в терминах порта: таймаут — «сервер не успел», а
/// не «нет соединения»: последнее поднимает во фронте оверлей связи, хотя
/// сеть в порядке — это медленный аплоад или инференс.
fn network_error(e: reqwest::Error) -> SttError {
    if e.is_timeout() && !e.is_connect() {
        return SttError::Retryable(TIMEOUT_STATUS);
    }
    SttError::Network(e.to_string())
}

/// Батч и стрим шлют одно и то же тело — WAV. Стрим получает сырой PCM из
/// конвейера и подшивает заголовок сам: контейнер — забота транспорта.
fn streaming_wav_body(chunks: AudioChunkStream) -> AudioChunkStream {
    let header: Result<Vec<u8>, std::io::Error> = Ok(audio::wav_header_streaming().to_vec());
    Box::pin(futures_util::stream::StreamExt::chain(futures_util::stream::iter([header]), chunks))
}

impl SttHttpClient {
    /// An id the registry does not know resolves to the default vendor rather
    /// than failing — the same rule `Settings::clamp` applies to the stored
    /// value. A Deepgram row is not served here: `build_engine` routes it to
    /// its own transport, and the multipart builders refuse it with an error.
    pub fn for_provider(provider_id: &str, api_key: String) -> Self {
        Self::over(registry::resolve(provider_id), api_key)
    }

    fn over(spec: &'static registry::SttProviderSpec, api_key: String) -> Self {
        Self {
            model: None,
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

    /// Таймаут батча растёт вместе с записью: база покрывает RTT и инференс
    /// короткой фразы, а длинная запись добавляет своё время на аплоад.
    fn batch_timeout(&self, samples: usize) -> std::time::Duration {
        let audio_secs = samples as f64 / f64::from(audio::TARGET_SAMPLE_RATE);
        self.timeout + std::time::Duration::from_secs_f64(audio_secs)
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
    ) -> Result<reqwest::multipart::Form, SttError> {
        let file = part.file_name(WAV_FILE_NAME);
        match self.spec.wire {
            registry::SttWire::OpenAiMultipart { transcribe_model, translation, temperature, .. } => {
                let model = translation
                    .filter(|_| self.translate())
                    .map_or_else(|| self.model.as_deref().unwrap_or(transcribe_model), |t| t.model);
                let mut form = reqwest::multipart::Form::new()
                    .part("file", file)
                    .text("model", model.to_string())
                    .text("response_format", "json");
                if let Some(temperature) = temperature {
                    form = form.text("temperature", temperature);
                }
                let form = match self.language_field() {
                    Some(language) => form.text("language", language),
                    None => form,
                };
                Ok(self.with_keyterms(form, keyterms))
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
                Ok(self.with_keyterms(form, keyterms).part("file", file))
            }
            // `build_engine` разворачивает Deepgram в собственный транспорт
            // раньше этого клиента. Ветка остаётся честной ошибкой, а не
            // паникой: клиент, собранный мимо фабрики, не роняет процесс.
            registry::SttWire::Deepgram { .. } => Err(SttError::Other(
                "у Deepgram свой транспорт — общий multipart-клиент его не обслуживает".into(),
            )),
        }
    }

    fn request_with(
        &self,
        part: reqwest::multipart::Part,
        keyterms: Keyterms<'_>,
        timeout: std::time::Duration,
    ) -> Result<reqwest::RequestBuilder, SttError> {
        Ok(self
            .client
            .post(format!("{}{}", self.base_url, self.spec.wire.path(self.translate())))
            .bearer_auth(&self.api_key)
            .multipart(self.form_with(part, keyterms)?)
            .timeout(timeout))
    }

    async fn parse_response(&self, resp: reqwest::Response) -> Result<String, SttError> {
        match resp.status().as_u16() {
            200 => Self::text_from_success(resp).await,
            code @ (401 | 403) if self.proxy => {
                Err(SttError::BadAccessCode(crate::llm::api_error_message(resp, code).await))
            }
            401 | 403 => Err(SttError::BadApiKey(self.spec.key_label)),
            code @ (429 | 500..=599) => Err(SttError::Retryable(code)),
            code => Err(SttError::Other(crate::llm::api_error_message(resp, code).await)),
        }
    }

    async fn text_from_success(resp: reqwest::Response) -> Result<String, SttError> {
        let v: serde_json::Value = resp.json().await.map_err(|e| SttError::Other(e.to_string()))?;
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
        let body = reqwest::Body::wrap_stream(streaming_wav_body(chunks));
        let part = reqwest::multipart::Part::stream(body)
            .mime_str(WAV_MIME)
            .map_err(|e| SttError::Other(e.to_string()))?;
        let send = self.request_with(part, keyterms, STREAM_REQUEST_TIMEOUT)?.send();
        let resp = tokio::select! {
            r = send => r.map_err(network_error)?,
            _ = cancel.cancelled() => return Err(SttError::Cancelled),
        };
        self.parse_response(resp).await
    }

    async fn warm_up(&self) {
        let _ = self
            .client
            .get(format!("{}{}", self.base_url, self.spec.wire.warm_up_path()))
            .timeout(WARM_UP_TIMEOUT)
            .send()
            .await;
    }

    async fn transcribe(
        &self,
        samples: &[f32],
        keyterms: Keyterms<'_>,
    ) -> Result<String, SttError> {
        let wav = audio::encode_wav_16k_mono(samples).map_err(|e| SttError::Other(e.to_string()))?;
        let part = reqwest::multipart::Part::bytes(wav)
            .mime_str(WAV_MIME)
            .map_err(|e| SttError::Other(e.to_string()))?;
        let resp = self
            .request_with(part, keyterms, self.batch_timeout(samples.len()))?
            .send()
            .await
            .map_err(network_error)?;
        self.parse_response(resp).await
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod openrouter_tests;
