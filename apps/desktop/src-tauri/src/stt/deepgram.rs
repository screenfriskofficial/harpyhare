//! Deepgram Nova-3 — единственный STT-вендор с реальным временем: аудио уходит
//! по WebSocket, пока клавиша удерживается, а не батчем после отпускания.
//! Батч (фолбэк) — сырой WAV телом на тот же путь.
//!
//! Адреса, пути и предел ключевых слов берутся из строки реестра, а не
//! дублируются здесь: у `DeepgramStt` нет своей правды о вендоре.

use std::sync::{Arc, OnceLock};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::tungstenite::{
    client::IntoClientRequest,
    http::{header::AUTHORIZATION, HeaderValue},
    Error as WsError, Message as WsMessage,
};

use super::registry::SttProviderSpec;
use super::{AudioChunkStream, Keyterms, SttEngine, SttError};
use crate::audio;

const MODEL: &str = "nova-3";
const MULTI_LANGUAGE: &str = "multi";
const DEFAULT_LANGUAGE: &str = "ru";
const WAV_MIME: &str = "audio/wav";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const WARM_UP_TIMEOUT: Duration = Duration::from_secs(5);
/// Хендшейк WebSocket: столько же, сколько connect у HTTP-клиента.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Один кадр аудио, который не ушёл за это время, — сеть встала: дальше
/// ждать нечего, конвейер уходит в батчевый фолбэк.
const SEND_TIMEOUT: Duration = Duration::from_secs(10);
/// Весь сеанс от хендшейка до финального транскрипта: запись живёт до 10
/// минут, минута сверху — на ответ. Раньше дедлайна не было вовсе, и сетевой
/// столл держал состояние «Расшифровка» до TCP-таймаутов ОС.
const SESSION_TIMEOUT: Duration = Duration::from_secs(11 * 60);
const CLOSE_TIMEOUT: Duration = Duration::from_secs(15);
const KEYTERM_PARAM: &str = "keyterm";

/// Корни доверия читаются из системного хранилища ОДИН раз на процесс:
/// `connect_async` без готового коннектора загружал keychain на каждое
/// нажатие PTT — десятки–сотни миллисекунд до первого кадра аудио.
fn websocket_tls() -> Arc<rustls::ClientConfig> {
    static TLS: OnceLock<Arc<rustls::ClientConfig>> = OnceLock::new();
    Arc::clone(TLS.get_or_init(|| {
        crate::tls::ensure_crypto_provider();
        let loaded = rustls_native_certs::load_native_certs();
        for err in &loaded.errors {
            eprintln!("корневой сертификат пропущен: {err}");
        }
        let mut roots = rustls::RootCertStore::empty();
        roots.add_parsable_certificates(loaded.certs);
        Arc::new(
            rustls::ClientConfig::builder()
                .with_root_certificates(roots)
                .with_no_client_auth(),
        )
    }))
}

#[derive(Clone)]
pub struct DeepgramStt {
    spec: &'static SttProviderSpec,
    api_key: String,
    base_url: String,
    client: reqwest::Client,
    language: String,
}

impl DeepgramStt {
    /// Строка реестра — единственный источник адресов и предела `keyterm`.
    pub fn from_spec(spec: &'static SttProviderSpec, api_key: String) -> Self {
        Self {
            spec,
            api_key,
            base_url: spec.wire.base_url().into(),
            client: super::warm_pooled_client(),
            language: DEFAULT_LANGUAGE.into(),
        }
    }

    pub fn with_language(mut self, language: String) -> Self {
        self.language = language;
        self
    }

    pub fn with_base_url(mut self, base_url: String) -> Self {
        self.base_url = base_url;
        self
    }

    fn listen_path(&self) -> &'static str {
        self.spec.wire.path(false)
    }

    fn language_param(&self) -> &str {
        let language = self.language.trim();
        if language.is_empty() {
            MULTI_LANGUAGE
        } else {
            language
        }
    }

    /// Термины, которые реально уйдут: предел вендора применяет реестр — тот
    /// же `accepted()`, что и у multipart-вендоров, иначе пресет с длинным
    /// списком давал бы 400 на каждой записи.
    fn accepted_keyterms<'a>(&self, keyterms: Keyterms<'a>) -> &'a [String] {
        self.spec.keyterms.accepted(keyterms)
    }

    fn rest_request(&self, wav: Vec<u8>, keyterms: Keyterms<'_>) -> reqwest::RequestBuilder {
        let mut query: Vec<(&str, &str)> = vec![
            ("model", MODEL),
            ("language", self.language_param()),
            ("smart_format", "true"),
        ];
        query.extend(
            self.accepted_keyterms(keyterms)
                .iter()
                .map(|t| (KEYTERM_PARAM, t.as_str())),
        );
        self.client
            .post(format!("{}{}", self.base_url, self.listen_path()))
            .header("Authorization", format!("Token {}", self.api_key))
            .header(reqwest::header::CONTENT_TYPE, WAV_MIME)
            .query(&query)
            .body(wav)
            .timeout(REQUEST_TIMEOUT)
    }

    /// Собираем через `Url`, а не форматированием: термины бывают многословными,
    /// и Deepgram требует их процентного кодирования — ручная склейка порвала бы
    /// запрос на первом же пробеле.
    fn websocket_url(&self, keyterms: Keyterms<'_>) -> String {
        let base = self.base_url.trim_end_matches('/');
        let ws_base = base
            .strip_prefix("https://")
            .map(|rest| format!("wss://{rest}"))
            .or_else(|| {
                base.strip_prefix("http://")
                    .map(|rest| format!("ws://{rest}"))
            })
            .unwrap_or_else(|| base.to_string());
        let endpoint = format!("{ws_base}{}", self.listen_path());
        let Ok(mut url) = reqwest::Url::parse(&endpoint) else {
            return endpoint;
        };
        {
            let mut query = url.query_pairs_mut();
            query.append_pair("model", MODEL);
            query.append_pair("language", self.language_param());
            query.append_pair("encoding", "linear16");
            query.append_pair("sample_rate", "16000");
            query.append_pair("channels", "1");
            query.append_pair("smart_format", "true");
            query.append_pair("punctuate", "true");
            for term in self.accepted_keyterms(keyterms) {
                query.append_pair(KEYTERM_PARAM, term);
            }
        }
        url.into()
    }

    fn websocket_request(
        &self,
        keyterms: Keyterms<'_>,
    ) -> Result<tokio_tungstenite::tungstenite::http::Request<()>, SttError> {
        let mut request = self
            .websocket_url(keyterms)
            .into_client_request()
            .map_err(|e| SttError::Other(format!("Deepgram WebSocket URL: {e}")))?;
        let auth = HeaderValue::from_bytes(format!("Token {}", self.api_key).as_bytes())
            .map_err(|e| SttError::Other(format!("Deepgram Authorization header: {e}")))?;
        request.headers_mut().insert(AUTHORIZATION, auth);
        Ok(request)
    }

    fn map_ws_connect_error(&self, error: WsError) -> SttError {
        match error {
            WsError::Http(response) => {
                let code = response.status().as_u16();
                crate::diagnostics::observe_response(code, response.headers());
                let body = response
                    .body()
                    .as_deref()
                    .and_then(|b| serde_json::from_slice(b).ok())
                    .unwrap_or_default();
                super::http_failure(
                    crate::error::http::HttpFailure {
                        status: code,
                        code: crate::error::http::classify(code, &body, false),
                        message: format!("HTTP {code}"),
                    },
                    self.spec.key_label,
                )
            }
            other => SttError::Network(format!("Deepgram WebSocket: {other}")),
        }
    }

    fn consume_stream_text(segments: &mut Vec<String>, raw: &str) -> Result<bool, SttError> {
        let value: serde_json::Value = serde_json::from_str(raw)
            .map_err(|e| SttError::Other(format!("Deepgram WebSocket JSON: {e}")))?;
        match value["type"].as_str() {
            Some("Results") => {
                if value["is_final"].as_bool().unwrap_or(false) {
                    if let Some(text) = value["channel"]["alternatives"][0]["transcript"]
                        .as_str()
                        .map(str::trim)
                        .filter(|text| !text.is_empty())
                    {
                        segments.push(text.to_string());
                    }
                }
                Ok(false)
            }
            Some("Metadata") => Ok(true),
            Some("Error") => {
                let message = value["description"]
                    .as_str()
                    .or_else(|| value["message"].as_str())
                    .or_else(|| value["error"].as_str())
                    .unwrap_or("неизвестная ошибка WebSocket");
                Err(SttError::Other(format!("Deepgram WebSocket: {message}")))
            }
            _ => Ok(false),
        }
    }

    /// Пусто — это пусто, а не ошибка: остальные вендоры отдают `""`, а
    /// конвейер знает, что делать с пустой расшифровкой. Ошибка здесь гнала
    /// бы ту же тишину второй раз через REST ради того же результата.
    fn transcript_from_segments(segments: &[String]) -> String {
        segments.join(" ").trim().to_string()
    }

    async fn parse_rest_response(&self, resp: reqwest::Response) -> Result<String, SttError> {
        match resp.status().as_u16() {
            200 => {
                let value: serde_json::Value = resp.json().await.map_err(|e| {
                    SttError::Other(format!("Deepgram: не удалось разобрать ответ: {e}"))
                })?;
                Ok(
                    value["results"]["channels"][0]["alternatives"][0]["transcript"]
                        .as_str()
                        .map(str::trim)
                        .unwrap_or_default()
                        .to_string(),
                )
            }
            _ => Err(super::http_failure(
                crate::error::http::failure(resp, false).await,
                self.spec.key_label,
            )),
        }
    }

    async fn stream_session(
        &self,
        mut chunks: AudioChunkStream,
        keyterms: Keyterms<'_>,
        cancel: &tokio_util::sync::CancellationToken,
    ) -> Result<String, SttError> {
        let request = self.websocket_request(keyterms)?;
        let connector = tokio_tungstenite::Connector::Rustls(websocket_tls());
        let connect = tokio::time::timeout(
            CONNECT_TIMEOUT,
            tokio_tungstenite::connect_async_tls_with_config(request, None, true, Some(connector)),
        );
        let (socket, response) = tokio::select! {
            result = connect => match result {
                Ok(connected) => connected.map_err(|e| self.map_ws_connect_error(e))?,
                Err(_) => return Err(SttError::Network("Deepgram WebSocket: таймаут подключения".into())),
            },
            _ = cancel.cancelled() => return Err(SttError::Cancelled),
        };
        crate::diagnostics::observe_response(response.status().as_u16(), response.headers());
        let (mut writer, mut reader) = socket.split();
        let mut segments = Vec::new();

        loop {
            tokio::select! {
                _ = cancel.cancelled() => return Err(SttError::Cancelled),
                item = chunks.next() => {
                    let Some(item) = item else { break };
                    let chunk = item.map_err(|e| SttError::Network(e.to_string()))?;
                    if !chunk.is_empty() {
                        send_frame(&mut writer, WsMessage::Binary(chunk.into()), "send").await?;
                    }
                }
                incoming = reader.next() => {
                    match incoming {
                        Some(Ok(WsMessage::Text(text))) => {
                            let _ = Self::consume_stream_text(&mut segments, text.as_str())?;
                        }
                        Some(Ok(WsMessage::Ping(data))) => {
                            send_frame(&mut writer, WsMessage::Pong(data), "pong").await?;
                        }
                        Some(Ok(WsMessage::Close(frame))) => {
                            return Err(SttError::Network(format!(
                                "Deepgram WebSocket закрылся до конца записи: {frame:?}"
                            )));
                        }
                        Some(Ok(_)) => {}
                        Some(Err(e)) => return Err(SttError::Network(format!("Deepgram WebSocket receive: {e}"))),
                        None => return Err(SttError::Network("Deepgram WebSocket закрылся до конца записи".into())),
                    }
                }
            }
        }

        send_frame(
            &mut writer,
            WsMessage::Text(
                serde_json::json!({"type": "CloseStream"})
                    .to_string()
                    .into(),
            ),
            "CloseStream",
        )
        .await?;

        let receive_final = async {
            loop {
                match reader.next().await {
                    Some(Ok(WsMessage::Text(text))) => {
                        if Self::consume_stream_text(&mut segments, text.as_str())? {
                            return Ok::<(), SttError>(());
                        }
                    }
                    Some(Ok(WsMessage::Ping(data))) => {
                        send_frame(&mut writer, WsMessage::Pong(data), "pong").await?;
                    }
                    Some(Ok(WsMessage::Close(_))) | None => return Ok(()),
                    Some(Ok(_)) => {}
                    Some(Err(e)) => {
                        return Err(SttError::Network(format!(
                            "Deepgram WebSocket receive: {e}"
                        )))
                    }
                }
            }
        };

        match tokio::select! {
            _ = cancel.cancelled() => return Err(SttError::Cancelled),
            result = tokio::time::timeout(CLOSE_TIMEOUT, receive_final) => result,
        } {
            Ok(result) => result?,
            Err(_) if segments.is_empty() => {
                return Err(SttError::Network(
                    "Deepgram не завершил WebSocket после CloseStream".into(),
                ));
            }
            Err(_) => {}
        }

        Ok(Self::transcript_from_segments(&segments))
    }
}

type WsWriter = futures_util::stream::SplitSink<
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    WsMessage,
>;

async fn send_frame(writer: &mut WsWriter, message: WsMessage, what: &str) -> Result<(), SttError> {
    match tokio::time::timeout(SEND_TIMEOUT, writer.send(message)).await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(e)) => Err(SttError::Network(format!("Deepgram WebSocket {what}: {e}"))),
        Err(_) => Err(SttError::Network(format!(
            "Deepgram WebSocket {what}: таймаут отправки"
        ))),
    }
}

#[async_trait::async_trait]
impl SttEngine for DeepgramStt {
    async fn transcribe_stream(
        &self,
        chunks: AudioChunkStream,
        keyterms: Keyterms<'_>,
        cancel: tokio_util::sync::CancellationToken,
    ) -> Result<String, SttError> {
        match tokio::time::timeout(
            SESSION_TIMEOUT,
            self.stream_session(chunks, keyterms, &cancel),
        )
        .await
        {
            Ok(result) => result,
            Err(_) => Err(SttError::Network(
                "Deepgram WebSocket: сеанс не уложился в отведённое время".into(),
            )),
        }
    }

    /// Греет и HTTP-пул (батч), и TLS-конфиг WebSocket — оба нужны первому
    /// нажатию, а хранилище корней читается медленно.
    async fn warm_up(&self) {
        let _ = tokio::task::spawn_blocking(websocket_tls).await;
        let _ = self
            .client
            .get(format!(
                "{}{}",
                self.base_url,
                self.spec.wire.warm_up_path()
            ))
            .header("Authorization", format!("Token {}", self.api_key))
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
        let resp = crate::diagnostics::send_request(self.rest_request(wav, keyterms).send())
            .await
            .map_err(super::network_error)?;
        self.parse_rest_response(resp).await
    }
}

#[cfg(test)]
mod tests;
