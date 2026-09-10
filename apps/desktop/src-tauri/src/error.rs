use serde::Serialize;

pub mod http;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    Network,
    BadApiKey,
    BadAccessCode,
    Retryable,
    Api,
    Cancelled,
    Permission,
    Silence,
    Internal,
    Billing,
    DailyLimit,
    RateLimited,
    ServiceUnavailable,
    Timeout,
    AccessDenied,
    ModelUnavailable,
    RequestTooLarge,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
}

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

pub trait CodedError: std::error::Error {
    fn code(&self) -> ErrorCode;
}

impl<E: CodedError> From<&E> for AppError {
    fn from(err: &E) -> Self {
        Self::new(err.code(), err.to_string())
    }
}

#[cfg(test)]
mod tests;
