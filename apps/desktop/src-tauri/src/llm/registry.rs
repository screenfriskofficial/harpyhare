use serde::Serialize;

use super::{
    xclis, ModelInfo, PROVIDER_ANTHROPIC, PROVIDER_OPENAI, PROVIDER_XAI, UNKNOWN_MAX_INPUT_TOKENS,
};

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
}

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
    /// Which `Settings.<key_id>_api_key` unlocks the vendor without an access
    /// code. Must be one of the ids in the frontend's `API_KEY_IDS` — asserted
    /// by `contract.test.ts`, because a typo here would silently lock the
    /// vendor forever.
    pub key_id: &'static str,
    /// Families the live catalogue is curated down to, newest of each kept.
    /// Empty means `catalog` below is already the curated list — that is the
    /// case whenever the vendor's `/models` endpoint carries no capabilities
    /// worth curating on.
    pub families: &'static [&'static str],
    /// Models offered before — or instead of — a live catalogue.
    pub catalog: &'static [CatalogModel],
    /// What a new chat opens on when this vendor is the one available.
    /// Declared, not "first of the catalogue": the catalogue is ordered
    /// flagship-first for the picker, while a new chat wants the *fast* model —
    /// the same reasoning that made Haiku the global default.
    pub default_model: &'static str,
    /// Whether the relay proxies this vendor, i.e. whether an access code alone
    /// unlocks it. False means the vendor needs the user's own key even under a
    /// code, and the picker keeps it locked until that key exists.
    pub proxied: bool,
    /// Which protocol the vendor speaks, and where. Rust-only: the frontend
    /// picks a vendor, it never dials one.
    #[serde(skip)]
    #[specta(skip)]
    pub wire: LlmWire,
}

/// The protocol a vendor speaks — and, with it, which client module serves it.
///
/// A dialect is a *variant*, not a vendor: `Responses` is spoken verbatim by
/// both OpenAI and xAI, so what separates them there is values, not code, and a
/// vendor reusing a dialect needs no new module and no new arm in
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
        /// `reasoning.effort` meaning "thinking off". Vendors disagree on
        /// whether reasoning can be switched off at all: OpenAI accepts
        /// `"none"`, xAI refuses it and its floor is `"minimal"`. Measured, not
        /// assumed — see `examples/openai_smoke.rs`.
        effort_off: &'static str,
        /// `reasoning.effort` meaning "thinking on".
        effort_on: &'static str,
    },
    /// OpenAI-совместимый `POST /v1/chat/completions`, а НЕ Responses: диалект
    /// другой, поэтому и вариант отдельный. Рассуждение здесь кодируется не
    /// полем, а суффиксом `-thinking` у имени модели.
    Xclis {
        base_url: &'static str,
        key_label: &'static str,
    },
}

impl LlmWire {
    pub fn base_url(&self) -> &'static str {
        match self {
            LlmWire::Anthropic { base_url, .. }
            | LlmWire::Responses { base_url, .. }
            | LlmWire::Xclis { base_url, .. } => base_url,
        }
    }

    pub fn key_label(&self) -> &'static str {
        match self {
            LlmWire::Anthropic { key_label, .. }
            | LlmWire::Responses { key_label, .. }
            | LlmWire::Xclis { key_label, .. } => key_label,
        }
    }
}

/// **Пусто намеренно, и это не заготовка.** Xclis — агрегатор: состав моделей
/// задаётся группой аккаунта на его стороне и меняется без нашего участия.
/// Проверено живьём двумя ключами: у одного каталог был целиком GPT, Grok и
/// deepseek, у другого — целиком Claude, без единого пересечения. Публичной
/// документации со списком у вендора нет, только «OpenAI API compatible».
///
/// Поэтому единственный честный офлайн-ответ про Xclis — «пока не знаю»:
/// `models()` подмешивает вшитый каталог ТОЛЬКО для вендоров, которых бэкенд
/// не отдал, так что живой `/v1/models` замещает эту пустоту целиком. Вписать
/// сюда любую модель значит обещать то, чего у конкретной группы может не быть,
/// — ровно так дефолт `claude-sonnet-5` и оказался несуществующим.
const XCLIS_MODELS: &[CatalogModel] = &[];

const CLAUDE_MODELS: &[CatalogModel] = &[
    CatalogModel {
        id: "claude-opus-4-8",
        display_name: "Claude Opus 4.8",
        adaptive: true,
        always_thinks: false,
        code_exec: true,
    },
    CatalogModel {
        id: "claude-sonnet-5",
        display_name: "Claude Sonnet 5",
        adaptive: true,
        always_thinks: false,
        code_exec: true,
    },
    CatalogModel {
        id: super::DEFAULT_MODEL,
        display_name: "Claude Haiku 4.5",
        adaptive: false,
        always_thinks: false,
        code_exec: false,
    },
];

/// Capabilities here are measured, not guessed: every entry was probed against
/// the live API (`examples/openai_smoke.rs`). `gpt-5.5-pro` is the only one that
/// refuses `reasoning.effort: "none"`, hence `always_thinks`.
const GPT_MODELS: &[CatalogModel] = &[
    CatalogModel {
        id: "gpt-5.6-terra",
        display_name: "GPT-5.6 Terra",
        adaptive: true,
        always_thinks: false,
        code_exec: true,
    },
    CatalogModel {
        id: "gpt-5.6-sol",
        display_name: "GPT-5.6 Sol",
        adaptive: true,
        always_thinks: false,
        code_exec: true,
    },
    CatalogModel {
        id: "gpt-5.6-luna",
        display_name: "GPT-5.6 Luna",
        adaptive: true,
        always_thinks: false,
        code_exec: true,
    },
    CatalogModel {
        id: "gpt-5.5-pro",
        display_name: "GPT-5.5 Pro",
        adaptive: true,
        always_thinks: true,
        code_exec: true,
    },
    CatalogModel {
        id: "gpt-5.4-mini",
        display_name: "GPT-5.4 mini",
        adaptive: true,
        always_thinks: false,
        code_exec: true,
    },
];

/// Probed live, like the GPT table. All three take `reasoning.effort` and reason
/// even at the floor, so none of them is `always_thinks` — the toggle moves real
/// work. The `grok-4.20-*` previews are left out on purpose: they reject the
/// `reasoning` parameter outright, so the toggle would silently do nothing.
/// xAI publishes `context_length`, so these get a real context gauge, unlike the
/// GPT rows above.
const GROK_MODELS: &[CatalogModel] = &[
    CatalogModel {
        id: "grok-4.6",
        display_name: "Grok 4.6",
        adaptive: true,
        always_thinks: false,
        code_exec: true,
    },
    CatalogModel {
        id: "grok-4.5",
        display_name: "Grok 4.5",
        adaptive: true,
        always_thinks: false,
        code_exec: true,
    },
    CatalogModel {
        id: "grok-4.3",
        display_name: "Grok 4.3",
        adaptive: true,
        always_thinks: false,
        code_exec: true,
    },
];

/// Order is UI order: the picker renders groups in this sequence, and the first
/// entry is the router's default for a model nobody claims.
pub const PROVIDERS: &[LlmProviderSpec] = &[
    LlmProviderSpec {
        id: PROVIDER_ANTHROPIC,
        label: "Claude",
        key_id: "anthropic",
        families: &["opus", "sonnet", "haiku"],
        catalog: CLAUDE_MODELS,
        default_model: super::DEFAULT_MODEL,
        proxied: true,
        wire: LlmWire::Anthropic {
            base_url: "https://api.anthropic.com",
            key_label: "Anthropic",
        },
    },
    LlmProviderSpec {
        id: PROVIDER_OPENAI,
        label: "OpenAI",
        key_id: "openai",
        families: &[],
        catalog: GPT_MODELS,
        // Fastest of the line by a wide margin — measured, see the smoke example.
        default_model: "gpt-5.4-mini",
        proxied: true,
        wire: LlmWire::Responses {
            base_url: "https://api.openai.com",
            key_label: "OpenAI",
            effort_off: "none",
            effort_on: "medium",
        },
    },
    // Grok speaks the Responses dialect verbatim, so it needs no module and no
    // arm in `build_provider` — this row is the whole integration. The relay
    // proxies it too: it shares `/v1/responses` with OpenAI there and the two
    // are told apart by the requested model, so an access code covers Grok
    // without the app knowing anything beyond its swapped base URL.
    LlmProviderSpec {
        id: PROVIDER_XAI,
        label: "Grok",
        key_id: "xai",
        families: &[],
        catalog: GROK_MODELS,
        default_model: "grok-4.3",
        proxied: true,
        wire: LlmWire::Responses {
            base_url: "https://api.x.ai",
            key_label: "xAI",
            // xAI refuses "none" outright; "minimal" is its floor.
            effort_off: "minimal",
            effort_on: "high",
        },
    },
    // Агрегатор чужих моделей под своим ключом. `proxied: false` — у relay нет
    // его роута, поэтому код доступа его не открывает; у диалекта Xclis нет и
    // прокси-режима вовсе, что закреплено тестом `the_xclis_dialect_cannot_be_proxied`.
    LlmProviderSpec {
        id: xclis::PROVIDER_XCLIS,
        label: "Xclis",
        key_id: "xclis",
        families: &[],
        catalog: XCLIS_MODELS,
        // Обещать нечего, пока не пришёл живой каталог: см. XCLIS_MODELS.
        default_model: "",
        proxied: false,
        wire: LlmWire::Xclis {
            base_url: "https://jp.xclis.ai",
            key_label: "Xclis",
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
            max_input_tokens: UNKNOWN_MAX_INPUT_TOKENS,
        }
    }
}

impl LlmProviderSpec {
    pub fn models(&self) -> Vec<ModelInfo> {
        self.catalog.iter().map(|m| m.to_model_info(self.id)).collect()
    }
}

/// Offline catalogue of a single vendor, tagged with its provider id.
pub fn catalog_models(provider_id: &str) -> Vec<ModelInfo> {
    spec(provider_id).map(LlmProviderSpec::models).unwrap_or_default()
}

#[cfg(test)]
mod tests;
