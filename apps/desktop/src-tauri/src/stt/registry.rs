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
    /// How declared `[keywords]` reach this vendor, if at all.
    #[serde(skip)]
    #[specta(skip)]
    pub keyterms: SttKeyterms,
    /// Whether an access code reaches this vendor. The relay proxies only the
    /// vendors it has a route and a secret for (Groq, OpenAI and xAI today);
    /// one it does not (Deepgram) still needs the user's own key — offering
    /// it under a code would 404 on every recording.
    pub proxied: bool,
    /// Whether the vendor can return English for speech in another language.
    /// Exported because the launcher greys its «Перевод на английский» toggle
    /// out for a vendor that cannot: silently transcribing instead of
    /// translating would look like the setting simply stopped working.
    pub supports_translate: bool,
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

/// How a vendor accepts declared terms to bias recognition with.
///
/// Measured per vendor, not assumed: xAI takes a repeatable `keyterm` and
/// **hard-errors above its cap instead of truncating**, so the cap has to be
/// respected here or every recording fails. `gpt-4o-mini-transcribe` accepts a
/// `prompt` field and demonstrably ignores it, so it is `Unsupported` — sending
/// something that does nothing would only invite the belief that it works.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SttKeyterms {
    Unsupported,
    /// One field repeated per term, capped by the vendor. Where the repetition
    /// lands is the transport's business: xAI repeats a multipart field,
    /// Deepgram repeats a query parameter — the shape is the same either way.
    Repeated { field: &'static str, max: usize },
    /// Whisper-style biasing: all terms in one free-text field.
    Prompt { field: &'static str },
}

/// The upload protocol a vendor speaks.
///
/// A dialect is a *variant*, not a vendor: `OpenAiMultipart` is spoken by both
/// Groq and OpenAI, so what separates those two is values. xAI is a genuinely
/// different shape — no model field, no translations endpoint, and `file` has
/// to be the last part — so it gets its own variant rather than a pile of
/// optional fields on the first.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SttWire {
    /// `POST /…/audio/transcriptions` with `model` + `response_format=json`.
    OpenAiMultipart {
        base_url: &'static str,
        transcribe_path: &'static str,
        translate_path: &'static str,
        warm_up_path: &'static str,
        transcribe_model: &'static str,
        /// Vendors disagree and both are load-bearing: Groq's turbo model
        /// cannot translate at all, and OpenAI's translations endpoint accepts
        /// nothing but `whisper-1`.
        translate_model: &'static str,
        /// `None` means "do not send the field". Only Groq documents it; for
        /// the 4o generation it is undocumented and guessing is not free.
        temperature: Option<&'static str>,
    },
    /// `POST /v1/listen`: сырой WAV телом, без multipart вовсе. Низколатентный
    /// путь у вендора — WebSocket на том же пути, поэтому у него отдельный
    /// транспорт (`stt::deepgram`), а не строка значений в общем клиенте.
    Deepgram {
        base_url: &'static str,
        listen_path: &'static str,
        warm_up_path: &'static str,
    },
    /// `POST /v1/stt`: one endpoint, no model to choose, and the audio part
    /// **must come last** — the server rejects a body that leads with it.
    Xai {
        base_url: &'static str,
        path: &'static str,
        warm_up_path: &'static str,
    },
}

impl SttWire {
    pub fn base_url(&self) -> &'static str {
        match self {
            SttWire::OpenAiMultipart { base_url, .. }
            | SttWire::Xai { base_url, .. }
            | SttWire::Deepgram { base_url, .. } => base_url,
        }
    }

    pub fn warm_up_path(&self) -> &'static str {
        match self {
            SttWire::OpenAiMultipart { warm_up_path, .. }
            | SttWire::Xai { warm_up_path, .. }
            | SttWire::Deepgram { warm_up_path, .. } => {
                warm_up_path
            }
        }
    }

    /// Where a request goes. `translate` only ever changes it on a dialect that
    /// has somewhere else to go.
    pub fn path(&self, translate: bool) -> &'static str {
        match self {
            SttWire::OpenAiMultipart { transcribe_path, translate_path, .. } => {
                if translate {
                    translate_path
                } else {
                    transcribe_path
                }
            }
            SttWire::Xai { path, .. } => path,
            SttWire::Deepgram { listen_path, .. } => listen_path,
        }
    }
}

pub const PROVIDER_GROQ: &str = "groq";
pub const PROVIDER_OPENAI: &str = "openai";
pub const PROVIDER_XAI: &str = "xai";
pub const PROVIDER_DEEPGRAM: &str = "deepgram";

/// Order is UI order, and the first row is the default: an unknown value in
/// `Settings.stt_provider` resolves to it rather than failing.
pub const PROVIDERS: &[SttProviderSpec] = &[
    SttProviderSpec {
        id: PROVIDER_GROQ,
        label: "Groq · Whisper",
        key_id: "groq",
        proxied: true,
        supports_translate: true,
        keyterms: SttKeyterms::Prompt { field: "prompt" },
        key_label: "Groq",
        wire: SttWire::OpenAiMultipart {
            base_url: "https://api.groq.com",
            transcribe_path: "/openai/v1/audio/transcriptions",
            translate_path: "/openai/v1/audio/translations",
            warm_up_path: "/openai/v1/models",
            transcribe_model: "whisper-large-v3-turbo",
            translate_model: "whisper-large-v3",
            temperature: Some("0"),
        },
    },
    // Chosen by a live A/B, not by price: gpt-4o-mini-transcribe is the only
    // model of its line that keeps English technical terms in Latin script
    // inside Russian speech without being prompted. See CLAUDE.md before
    // "upgrading" it to a bigger sibling — that was measured as a regression.
    SttProviderSpec {
        id: PROVIDER_OPENAI,
        label: "OpenAI · gpt-4o mini",
        key_id: "openai",
        proxied: true,
        supports_translate: true,
        // Accepts `prompt` and measurably ignores it — see CLAUDE.md. The
        // keyword-capable sibling is `gpt-transcribe`, which this row
        // deliberately does not use.
        keyterms: SttKeyterms::Unsupported,
        key_label: "OpenAI",
        wire: SttWire::OpenAiMultipart {
            base_url: "https://api.openai.com",
            transcribe_path: "/v1/audio/transcriptions",
            translate_path: "/v1/audio/translations",
            warm_up_path: "/v1/models",
            transcribe_model: "gpt-4o-mini-transcribe",
            translate_model: "whisper-1",
            temperature: None,
        },
    },
    // xAI publishes no translations endpoint, so `supports_translate` is false
    // and the launcher greys the toggle out while this vendor is selected.
    // Its `keyterm` biasing carries the terms a prompt declares through
    // `[keywords]: [...]` — a hand-kept dictionary setting was rejected, the
    // in-prompt declaration was not (see CLAUDE.md).
    SttProviderSpec {
        id: PROVIDER_XAI,
        label: "Grok · Speech-to-Text",
        key_id: "xai",
        proxied: true,
        supports_translate: false,
        // Hard error above 100, verified — not a silent truncation.
        keyterms: SttKeyterms::Repeated { field: "keyterm", max: 100 },
        key_label: "xAI",
        wire: SttWire::Xai {
            base_url: "https://api.x.ai",
            path: "/v1/stt",
            warm_up_path: "/v1/models",
        },
    },
    // Единственный вендор, который слышит речь ПОКА её говорят: аудио уходит
    // по WebSocket во время удержания клавиши, а не батчем после отпускания.
    // Перевода не предлагает; `proxied: false` — у relay нет его роута, поэтому
    // под кодом доступа он берёт личный ключ.
    SttProviderSpec {
        id: PROVIDER_DEEPGRAM,
        label: "Deepgram · Nova-3",
        key_id: "deepgram",
        proxied: false,
        supports_translate: false,
        // Keyterm Prompting у Nova-3: повторяющийся `keyterm=` в query.
        // Настоящий предел вендора — 500 ТОКЕНОВ на все термины разом, а не их
        // число, посчитать его на клиенте нечем. Берём документированный потолок
        // рекомендации (20–50 терминов): он заведомо внутри лимита.
        keyterms: SttKeyterms::Repeated { field: "keyterm", max: 50 },
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
/// all lean on it instead of each re-deciding.
pub fn resolve(provider_id: &str) -> &'static SttProviderSpec {
    spec(provider_id).unwrap_or_else(default_spec)
}

impl SttKeyterms {
    /// Terms this vendor will actually accept, already capped. Empty means
    /// "send nothing", which is also the answer for a vendor that ignores them.
    pub fn accepted<'a>(&self, terms: &'a [String]) -> &'a [String] {
        match self {
            SttKeyterms::Unsupported => &[],
            SttKeyterms::Repeated { max, .. } => &terms[..terms.len().min(*max)],
            SttKeyterms::Prompt { .. } => terms,
        }
    }
}

/// Translation only happens where the vendor offers it. A stored `true` against
/// a vendor that cannot translate would otherwise transcribe silently, which
/// reads as the setting having quietly broken.
pub fn effective_translate(spec: &SttProviderSpec, requested: bool) -> bool {
    requested && spec.supports_translate
}

#[cfg(test)]
mod tests;
