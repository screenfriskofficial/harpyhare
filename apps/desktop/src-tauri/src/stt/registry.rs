use serde::Serialize;

/// Everything that differs between speech-to-text vendors.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SttProviderSpec {
    /// The value stored in `Settings.stt_provider`.
    pub id: &'static str,
    /// Shown in the launcher select and in the HUD model menu.
    pub label: &'static str,
    /// Which `Settings.<key_id>_api_key` this vendor needs.
    pub key_id: &'static str,
    /// How many declared `[keywords]` reach this vendor.
    #[serde(skip)]
    #[specta(skip)]
    pub keyterms: SttKeyterms,
    /// Vendor name inside «Неверный ключ …», so the message points at the key
    /// that actually needs fixing. Rust-only: the frontend never renders it.
    #[serde(skip)]
    #[specta(skip)]
    pub key_label: &'static str,
    /// The protocol this vendor speaks, and where. Rust-only: the frontend
    /// picks a vendor, it never dials one.
    #[serde(skip)]
    #[specta(skip)]
    pub wire: SttWire,
}

/// How many declared terms a vendor accepts to bias recognition with.
///
/// The cap is the vendor's, measured rather than assumed: a list above it is a
/// 400 on every recording rather than a silent truncation, so it has to be
/// respected here. Where the terms land (a repeated query parameter, a form
/// field) is the transport's business.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SttKeyterms {
    pub max: usize,
}

/// The upload protocol a vendor speaks.
///
/// A dialect is a *variant*, not a vendor: a second vendor speaking a known
/// protocol is a row with other values, and only a genuinely new protocol adds
/// a variant here, a transport beside `stt::deepgram` and an arm in
/// `stt::build_engine`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SttWire {
    /// `POST /v1/listen`: сырой WAV телом, без multipart вовсе. Низколатентный
    /// путь у вендора — WebSocket на том же пути, поэтому у него отдельный
    /// транспорт (`stt::deepgram`), а не строка значений в общем клиенте.
    Deepgram {
        base_url: &'static str,
        listen_path: &'static str,
        warm_up_path: &'static str,
    },
}

impl SttWire {
    pub fn base_url(&self) -> &'static str {
        match self {
            SttWire::Deepgram { base_url, .. } => base_url,
        }
    }

    pub fn warm_up_path(&self) -> &'static str {
        match self {
            SttWire::Deepgram { warm_up_path, .. } => warm_up_path,
        }
    }

    /// Where a recording goes.
    pub fn path(&self) -> &'static str {
        match self {
            SttWire::Deepgram { listen_path, .. } => listen_path,
        }
    }
}

pub const PROVIDER_DEEPGRAM: &str = "deepgram";

/// Order is UI order, and the first row is the default: an unknown value in
/// `Settings.stt_provider` resolves to it rather than failing.
pub const PROVIDERS: &[SttProviderSpec] = &[
    // Слышит речь ПОКА её говорят: аудио уходит по WebSocket во время записи,
    // а не батчем после отпускания. Перевода на английский у вендора нет.
    SttProviderSpec {
        id: PROVIDER_DEEPGRAM,
        label: "Deepgram · Nova-3",
        key_id: "deepgram",
        // Keyterm Prompting у Nova-3: повторяющийся `keyterm=` в query.
        // Настоящий предел вендора — 500 ТОКЕНОВ на все термины разом, а не их
        // число, посчитать его на клиенте нечем. Берём документированный потолок
        // рекомендации (20–50 терминов): он заведомо внутри лимита.
        keyterms: SttKeyterms { max: 50 },
        key_label: "Deepgram",
        wire: SttWire::Deepgram {
            // Европейский хост выбран намеренно: у Deepgram он отдельный, и
            // общий api.deepgram.com на европейский ключ отвечает 401.
            base_url: "https://api.eu.deepgram.com",
            listen_path: "/v1/listen",
            warm_up_path: "/v1/projects",
        },
    },
];

pub fn spec(provider_id: &str) -> Option<&'static SttProviderSpec> {
    PROVIDERS.iter().find(|p| p.id == provider_id)
}

pub fn default_spec() -> &'static SttProviderSpec {
    &PROVIDERS[0]
}

/// The vendor a settings value names, or the default when it names none.
///
/// This is the single definition of "unknown provider falls back to the first
/// one" — `Settings::clamp`, the client builder and the frontend's key lookup
/// all lean on it instead of each re-deciding. It is also what moves a
/// settings file written when the app had more vendors onto one it still has.
pub fn resolve(provider_id: &str) -> &'static SttProviderSpec {
    spec(provider_id).unwrap_or_else(default_spec)
}

impl SttKeyterms {
    /// Terms this vendor will actually accept, already capped.
    pub fn accepted<'a>(&self, terms: &'a [String]) -> &'a [String] {
        &terms[..terms.len().min(self.max)]
    }
}

#[cfg(test)]
mod tests;
