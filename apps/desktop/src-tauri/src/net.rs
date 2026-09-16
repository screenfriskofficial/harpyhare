//! One HTTP client recipe for every long-lived vendor pool.
//!
//! The LLM and STT clients used to build their pools separately, each with its
//! own copy of the same timeouts and keep-alive settings — and each copy was a
//! place for the two to drift apart. Everything vendor-neutral about a pooled
//! client lives here; a module adds only what is its own (the LLM read timeout,
//! the Xclis proxy policy) on top of the builder.

use std::time::Duration;

/// Sent by every client. Without a `User-Agent` reqwest trips Cloudflare's
/// browser integrity check in front of the relay: intermittent
/// `403 error code: 1010`.
pub const APP_USER_AGENT: &str = concat!("AudioSystem/", env!("CARGO_PKG_VERSION"));

pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// A warm-up only opens the socket and throws the answer away.
pub const WARM_UP_TIMEOUT: Duration = Duration::from_secs(5);
/// HTTP/2 pings on the idle pool. The timeout is what closes a dead connection
/// after a VPN or interface change: the interval alone never notices a missing
/// ACK.
const HTTP2_KEEP_ALIVE_INTERVAL: Duration = Duration::from_secs(30);
const HTTP2_KEEP_ALIVE_TIMEOUT: Duration = Duration::from_secs(5);

/// The pool kept "forever warm": no idle timeout, HTTP/2 keep-alive pings even
/// while idle, the app's `User-Agent` and the shared connect timeout. Callers
/// add their own read or per-request timeouts on top.
pub fn pooled_client_builder() -> reqwest::ClientBuilder {
    crate::tls::ensure_crypto_provider();
    reqwest::Client::builder()
        .user_agent(APP_USER_AGENT)
        .connect_timeout(CONNECT_TIMEOUT)
        .pool_idle_timeout(None)
        .http2_keep_alive_interval(HTTP2_KEEP_ALIVE_INTERVAL)
        .http2_keep_alive_timeout(HTTP2_KEEP_ALIVE_TIMEOUT)
        .http2_keep_alive_while_idle(true)
}

/// `pooled_client_builder` built as is — the STT transports need nothing more.
pub fn pooled_client() -> reqwest::Client {
    pooled_client_builder().build().expect("reqwest client")
}
