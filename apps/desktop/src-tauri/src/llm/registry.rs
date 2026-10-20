use serde::Serialize;

use super::{Effort, ModelInfo, PROVIDER_ANTHROPIC, PROVIDER_OPENAI};

/// A model the app can name before it holds any credential to verify it with.
///
/// Deliberately not `ModelInfo`: that one is built from live API answers and
/// owns its strings, this one has to be `const`-able so the whole registry can
/// be a compile-time constant and cross the IPC boundary as one.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CatalogModel {
    pub id: &'static str,
    pub display_name: &'static str,
    /// Thinking can be switched off for this model.
    pub adaptive: bool,
    /// Model always reasons — the thinking toggle is meaningless and gets locked.
    pub always_thinks: bool,
    pub code_exec: bool,
    /// Effort levels the model accepts, weakest first. Measured like the rest
    /// of the row: an unlisted level would be a 400 on every request.
    pub efforts: &'static [Effort],
    /// Reasons only through manual extended thinking — an on/off switch.
    pub budget_thinking: bool,
    /// The level a request carries when the chat picked none — the vendor's
    /// documented default (Anthropic) or the dialect's «on» value (OpenAI).
    pub default_effort: Option<Effort>,
}

/// The whole ladder: Claude 4.7+ and the GPT-6 line.
const EVERY_EFFORT: &[Effort] = &Effort::ALL;
/// Everything below `max` — GPT-5.4 mini refuses it.
const EFFORTS_TO_XHIGH: &[Effort] = &[Effort::Low, Effort::Medium, Effort::High, Effort::Xhigh];

/// Everything about a vendor that is NOT its wire protocol.
///
/// This is the single place a new answer vendor is declared. The wire protocol
/// lives in `llm/<vendor>.rs`, the constructor in `app_state::build_provider`,
/// and **nothing else** — the frontend derives its picker groups, its offline
/// catalogue and its "no key" locks from this table through `bindings.ts`, so a
/// vendor added here shows up in the UI without a line of TypeScript.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LlmProviderSpec {
    /// Matches `ModelInfo.provider` and `LlmProvider::provider_id`.
    pub id: &'static str,
    /// Group heading in the model pickers.
    pub label: &'static str,
    /// Which `Settings.<key_id>_api_key` unlocks the vendor. Must be one of
    /// the ids in the frontend's `API_KEY_IDS` — asserted
    /// by `contract.test.ts`, because a typo here would silently lock the
    /// vendor forever.
    pub key_id: &'static str,
    /// Models offered before — or instead of — a live catalogue. Once the
    /// live one arrives it is shown whole, every model the key can call; this
    /// table only names models before a key exists and routes saved chats.
    pub catalog: &'static [CatalogModel],
    /// What a new chat opens on when this vendor is the one available.
    /// Declared, not "first of the catalogue": the catalogue is ordered
    /// flagship-first for the picker, while a new chat wants the *fast* model —
    /// the same reasoning that made Haiku the global default.
    pub default_model: &'static str,
    /// Which protocol the vendor speaks, and where. Rust-only: the frontend
    /// picks a vendor, it never dials one.
    #[serde(skip)]
    #[specta(skip)]
    pub wire: LlmWire,
}

/// The protocol a vendor speaks — and, with it, which client module serves it.
///
/// A dialect is a *variant*, not a vendor: a vendor speaking a dialect the app
/// already knows (the Responses API is spoken verbatim by more than OpenAI)
/// needs a row with its own values and nothing else — no module, no arm in
/// `app_state::build_provider`. A genuinely new protocol adds a variant here,
/// a module beside `responses`, and one arm there.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum LlmWire {
    /// Anthropic Messages API: its own body shape, its own SSE events.
    Anthropic {
        base_url: &'static str,
        /// Vendor name inside «Неверный ключ …».
        key_label: &'static str,
    },
    /// OpenAI Responses API.
    Responses {
        base_url: &'static str,
        key_label: &'static str,
        /// `reasoning.effort` meaning "thinking off". Vendors of this dialect
        /// disagree on whether reasoning can be switched off at all (OpenAI
        /// accepts `"none"`, others floor at `"minimal"`), so it is a value of
        /// the row. Measured, not assumed — see `examples/responses_smoke.rs`.
        effort_off: &'static str,
        /// `reasoning.effort` meaning "thinking on".
        effort_on: &'static str,
    },
}

impl LlmWire {
    pub fn base_url(&self) -> &'static str {
        match self {
            LlmWire::Anthropic { base_url, .. } | LlmWire::Responses { base_url, .. } => base_url,
        }
    }

    pub fn key_label(&self) -> &'static str {
        match self {
            LlmWire::Anthropic { key_label, .. } | LlmWire::Responses { key_label, .. } => {
                key_label
            }
        }
    }
}

/// The newest of each family as `/v1/models` reported them on 2026-10-20,
/// capabilities included; the live catalogue replaces this table whole.
const CLAUDE_MODELS: &[CatalogModel] = &[
    CatalogModel {
        id: "claude-opus-5-5",
        display_name: "Claude Opus 5.5",
        adaptive: true,
        always_thinks: true,
        code_exec: true,
        efforts: EVERY_EFFORT,
        budget_thinking: false,
        // Documented: Opus 5.5 defaults to `medium`, one below Opus 5.
        default_effort: Some(Effort::Medium),
    },
    CatalogModel {
        id: "claude-sonnet-5-5",
        display_name: "Claude Sonnet 5.5",
        adaptive: true,
        always_thinks: true,
        code_exec: true,
        efforts: EVERY_EFFORT,
        budget_thinking: false,
        default_effort: Some(Effort::High),
    },
    CatalogModel {
        id: "claude-haiku-5-5",
        display_name: "Claude Haiku 5.5",
        adaptive: true,
        always_thinks: true,
        code_exec: true,
        efforts: EVERY_EFFORT,
        budget_thinking: false,
        // Documented: Haiku 5.5 defaults to `medium`.
        default_effort: Some(Effort::Medium),
    },
    CatalogModel {
        id: super::DEFAULT_MODEL,
        display_name: "Claude Haiku 4.5",
        adaptive: false,
        always_thinks: false,
        code_exec: false,
        efforts: &[],
        budget_thinking: true,
        default_effort: None,
    },
];

/// Capabilities here are measured, not guessed — by the same free probe that
/// reads the live catalogue (`responses::probe`, run on 2026-10-20): a refused
/// level is a 400 that lists the accepted ones. A model without `"none"` among
/// them cannot stop reasoning, hence `always_thinks` on `gpt-6.1-sol` and
/// `gpt-5.5-pro`; `gpt-5.5-pro` takes only medium/high/xhigh, and
/// `gpt-5.4-mini` stops at xhigh.
const GPT_MODELS: &[CatalogModel] = &[
    CatalogModel {
        id: "gpt-6.1-sol",
        display_name: "GPT-6.1 Sol",
        adaptive: true,
        always_thinks: true,
        code_exec: true,
        efforts: EVERY_EFFORT,
        budget_thinking: false,
        default_effort: Some(Effort::Medium),
    },
    CatalogModel {
        id: "gpt-6-sol",
        display_name: "GPT-6 Sol",
        adaptive: true,
        always_thinks: false,
        code_exec: true,
        efforts: EVERY_EFFORT,
        budget_thinking: false,
        default_effort: Some(Effort::Medium),
    },
    CatalogModel {
        id: "gpt-6-luna",
        display_name: "GPT-6 Luna",
        adaptive: true,
        always_thinks: false,
        code_exec: true,
        efforts: EVERY_EFFORT,
        budget_thinking: false,
        default_effort: Some(Effort::Medium),
    },
    CatalogModel {
        id: "gpt-5.5-pro",
        display_name: "GPT-5.5 Pro",
        adaptive: true,
        always_thinks: true,
        code_exec: true,
        efforts: &[Effort::Medium, Effort::High, Effort::Xhigh],
        budget_thinking: false,
        default_effort: Some(Effort::Medium),
    },
    CatalogModel {
        id: "gpt-5.4-mini",
        display_name: "GPT-5.4 mini",
        adaptive: true,
        always_thinks: false,
        code_exec: true,
        efforts: EFFORTS_TO_XHIGH,
        budget_thinking: false,
        default_effort: Some(Effort::Medium),
    },
];

/// Order is UI order: the picker renders groups in this sequence, and the first
/// entry is the router's default for a model nobody claims.
pub const PROVIDERS: &[LlmProviderSpec] = &[
    LlmProviderSpec {
        id: PROVIDER_ANTHROPIC,
        label: "Claude",
        key_id: "anthropic",
        catalog: CLAUDE_MODELS,
        default_model: super::DEFAULT_MODEL,
        wire: LlmWire::Anthropic {
            base_url: "https://api.anthropic.com",
            key_label: "Anthropic",
        },
    },
    LlmProviderSpec {
        id: PROVIDER_OPENAI,
        label: "OpenAI",
        key_id: "openai",
        catalog: GPT_MODELS,
        // Fastest of the line by a wide margin — measured, see the smoke example.
        default_model: "gpt-5.4-mini",
        wire: LlmWire::Responses {
            base_url: "https://api.openai.com",
            key_label: "OpenAI",
            effort_off: "none",
            effort_on: "medium",
        },
    },
];

pub fn spec(provider_id: &str) -> Option<&'static LlmProviderSpec> {
    PROVIDERS.iter().find(|p| p.id == provider_id)
}

impl CatalogModel {
    pub fn to_model_info(self, provider: &str) -> ModelInfo {
        ModelInfo {
            id: self.id.into(),
            display_name: self.display_name.into(),
            provider: provider.into(),
            adaptive: self.adaptive,
            always_thinks: self.always_thinks,
            code_exec: self.code_exec,
            efforts: self.efforts.to_vec(),
            budget_thinking: self.budget_thinking,
            default_effort: self.default_effort,
        }
    }
}

impl LlmProviderSpec {
    pub fn models(&self) -> Vec<ModelInfo> {
        self.catalog
            .iter()
            .map(|m| m.to_model_info(self.id))
            .collect()
    }
}

/// Offline catalogue of a single vendor, tagged with its provider id.
pub fn catalog_models(provider_id: &str) -> Vec<ModelInfo> {
    spec(provider_id)
        .map(LlmProviderSpec::models)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests;
