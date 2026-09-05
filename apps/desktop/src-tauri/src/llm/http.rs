use serde_json::Value;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

use super::{
    build_http_client, network_error, probe_http_client, pump_sse_stream, require_ok_status,
    HttpClientOptions, LlmError, LlmStreamSink, SseParser, REQUEST_TIMEOUT, WARM_UP_TIMEOUT,
};

/// How a request proves who it is.
///
/// `Bearer` covers two different things on purpose: a vendor whose own scheme is
/// bearer auth, and the relay's `itk_` token, which replaces the vendor
/// credential entirely. `LlmHttp::proxy` is what tells them apart, and it only
/// matters for error mapping — a 401 from the relay means the access code is
/// dead, a 401 from the vendor means the user's key is wrong.
#[derive(Clone)]
pub enum Credential {
    ApiKeyHeader { header: &'static str, key: String },
    Bearer(String),
}

pub type StaticHeaders = &'static [(&'static str, &'static str)];

/// Everything about talking to an LLM HTTP API that is not vendor-specific:
/// the pooled client, auth, error mapping, cancellation and SSE pumping.
///
/// A vendor module owns its request body, its SSE dialect and its catalogue —
/// and nothing else. Before this existed each new vendor re-implemented client
/// construction, header plumbing, status mapping, the cancel/select dance and
/// the reachability probe, which is roughly half of what a vendor module used
/// to be.
#[derive(Clone)]
pub struct LlmHttp {
    client: reqwest::Client,
    base_url: String,
    credential: Credential,
    key_label: &'static str,
    headers: StaticHeaders,
    proxy: bool,
    options: HttpClientOptions,
}

impl LlmHttp {
    /// Straight at the vendor with the user's own credential.
    pub fn direct(base_url: impl Into<String>, credential: Credential, key_label: &'static str) -> Self {
        Self::with_options(base_url, credential, key_label, HttpClientOptions::default())
    }

    /// `direct` with an explicit pool configuration (idle timeout, proxy policy).
    pub(crate) fn with_options(
        base_url: impl Into<String>,
        credential: Credential,
        key_label: &'static str,
        options: HttpClientOptions,
    ) -> Self {
        Self {
            client: build_http_client(options),
            base_url: base_url.into(),
            credential,
            key_label,
            headers: &[],
            proxy: false,
            options,
        }
    }

    /// Through the relay, authenticated by an access token.
    pub fn proxied(base_url: impl Into<String>, access_token: String, key_label: &'static str) -> Self {
        Self {
            proxy: true,
            ..Self::direct(base_url, Credential::Bearer(access_token), key_label)
        }
    }

    /// Headers every request to this vendor carries (`anthropic-version`).
    pub fn with_headers(mut self, headers: StaticHeaders) -> Self {
        self.headers = headers;
        self
    }

    pub fn with_read_timeout(mut self, d: Duration) -> Self {
        self.options.read_timeout = d;
        self.client = build_http_client(self.options);
        self
    }

    pub fn with_base_url(mut self, base_url: String) -> Self {
        self.base_url = base_url;
        self
    }

    /// The same pool under another credential — for a vendor whose endpoints
    /// authenticate differently (Xclis: bearer for chat, `x-api-key` for the
    /// Anthropic-shaped catalogue and token counter).
    pub fn with_credential(mut self, credential: Credential) -> Self {
        self.credential = credential;
        self
    }

    pub fn is_proxy(&self) -> bool {
        self.proxy
    }

    fn url(&self, path: &str) -> String {
        format!("{}{path}", self.base_url)
    }

    fn prepared(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        let req = self
            .headers
            .iter()
            .fold(req, |acc, (name, value)| acc.header(*name, *value));
        match &self.credential {
            Credential::ApiKeyHeader { header, key } => req.header(*header, key),
            Credential::Bearer(token) => req.bearer_auth(token),
        }
    }

    async fn send(&self, req: reqwest::RequestBuilder) -> Result<reqwest::Response, LlmError> {
        self.prepared(req).send().await.map_err(network_error)
    }

    async fn json_of(resp: reqwest::Response) -> Result<Value, LlmError> {
        resp.json().await.map_err(network_error)
    }

    /// `path` carries its own query string when the vendor needs one.
    pub async fn get_json(&self, path: &str, timeout: Duration) -> Result<Value, LlmError> {
        let resp = self.send(self.client.get(self.url(path)).timeout(timeout)).await?;
        let resp = require_ok_status(resp, self.key_label, self.proxy).await?;
        Self::json_of(resp).await
    }

    pub async fn post_json(&self, path: &str, body: &Value) -> Result<Value, LlmError> {
        let resp = self
            .send(self.client.post(self.url(path)).json(body).timeout(REQUEST_TIMEOUT))
            .await?;
        let resp = require_ok_status(resp, self.key_label, self.proxy).await?;
        Self::json_of(resp).await
    }

    /// POST a body and hand back the status-checked response, honouring
    /// `cancel` while the request is in flight. What the body is — SSE, JSON —
    /// is the caller's call; `post_sse` is the common case.
    pub async fn post_response(
        &self,
        path: &str,
        body: &Value,
        cancel: &CancellationToken,
        accept: Option<&'static str>,
    ) -> Result<reqwest::Response, LlmError> {
        let mut req = self.client.post(self.url(path)).json(body);
        if let Some(mime) = accept {
            req = req.header(reqwest::header::ACCEPT, mime);
        }
        let send = self.prepared(req).send();
        let resp = tokio::select! {
            r = send => r.map_err(network_error)?,
            _ = cancel.cancelled() => return Err(LlmError::Cancelled),
        };
        require_ok_status(resp, self.key_label, self.proxy).await
    }

    /// POST a body and pump the SSE answer into `sink`, honouring `cancel` both
    /// while the request is in flight and while the stream is running — without
    /// which "Stop" would still be billed for a whole generation.
    pub async fn post_sse(
        &self,
        path: &str,
        body: &Value,
        parser: SseParser,
        cancel: CancellationToken,
        sink: &mut dyn LlmStreamSink,
    ) -> Result<(), LlmError> {
        let resp = self.post_response(path, body, &cancel, None).await?;
        pump_sse_stream(resp, parser, &cancel, sink).await
    }

    /// Connectivity probe on the process-wide pool-less client: a probe issued
    /// on the shared pool can park behind a dead keep-alive connection and hang
    /// far past its own timeout.
    pub async fn reachable(&self, path: &str) -> bool {
        self.prepared(probe_http_client().get(self.url(path))).send().await.is_ok()
    }

    /// Opens the connection so the first real request does not pay for TLS.
    /// Unauthenticated on purpose — only the socket is being warmed, and the
    /// answer is thrown away.
    pub async fn warm_up(&self, path: &str) {
        let _ = self.client.get(self.url(path)).timeout(WARM_UP_TIMEOUT).send().await;
    }
}

#[cfg(test)]
mod tests;
