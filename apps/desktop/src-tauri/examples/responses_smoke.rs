//! Live diagnosis of the Responses dialect against every vendor that declares
//! it. Run it after touching `llm/responses.rs` or after adding a row:
//!
//!   cargo run --example responses_smoke
//!
//! Keys come from `.env` by the registry's own naming — `<KEY_ID>_API_KEY` —
//! so a vendor added to the registry is picked up here without editing this
//! file. Vendors without a key in the environment are skipped, not failed.

use harpyhare_lib::llm::{
    registry, responses::ResponsesClient, router::ProviderRouter, ChatMessage, LlmProvider,
    LlmRequest, LlmStreamSink, ModelCatalog, RequestOptions,
};
use std::sync::{Arc, Mutex};

const DESKTOP_ENV_PATH: &str = "../.env";
const WORKSPACE_ENV_PATH: &str = "../../../.env";
const ANTHROPIC_KEY_ENV: &str = "ANTHROPIC_API_KEY";

const BRIEF_SYSTEM: &str = "Отвечай одним словом, по-русски.";
const ROLE_USER: &str = "user";
const ROLE_ASSISTANT: &str = "assistant";
const ANSWER_PREVIEW_CHARS: usize = 80;

struct CollectingSink {
    text: String,
}

impl LlmStreamSink for CollectingSink {
    fn text_delta(&mut self, delta: &str) {
        self.text.push_str(delta);
    }
}

fn message(role: &str, text: &str) -> ChatMessage {
    ChatMessage {
        role: role.into(),
        text: text.into(),
        images: vec![],
    }
}

fn request(model: &str, messages: Vec<ChatMessage>, options: RequestOptions) -> LlmRequest {
    LlmRequest {
        model: model.into(),
        system: BRIEF_SYSTEM.into(),
        messages,
        options,
    }
}

/// `openai` → `OPENAI_API_KEY`, `xai` → `XAI_API_KEY`. Same convention the app
/// itself uses for its `.env` fallback.
fn key_env_var(key_id: &str) -> String {
    format!("{}_API_KEY", key_id.to_uppercase())
}

async fn run_stream_case(provider: &dyn LlmProvider, name: &str, request: LlmRequest) {
    let mut sink = CollectingSink {
        text: String::new(),
    };
    let started = std::time::Instant::now();
    match provider
        .stream(
            request,
            tokio_util::sync::CancellationToken::new(),
            &mut sink,
        )
        .await
    {
        Ok(()) => {
            let preview: String = sink
                .text
                .trim()
                .chars()
                .take(ANSWER_PREVIEW_CHARS)
                .collect();
            println!("  [OK ] {name}: «{preview}» ({:?})", started.elapsed());
        }
        Err(e) => println!("  [ERR] {name}: {e}"),
    }
}

async fn run_vendor_cases(spec: &'static registry::LlmProviderSpec, api_key: String) {
    println!("── {} ({}) ──", spec.label, spec.id);
    let client = ResponsesClient::direct(spec, api_key);

    let models = match client.list_models().await {
        Ok(models) => {
            for m in &models {
                println!("  [OK ] каталог: {}", m.id);
            }
            models
        }
        Err(e) => {
            println!("  [ERR] каталог: {e}");
            return;
        }
    };
    let Some(first) = models.first() else {
        println!("  [ERR] каталог пуст — курированные модели ключу недоступны");
        return;
    };

    let single = vec![message(ROLE_USER, "Столица Франции?")];
    let multi = vec![
        message(ROLE_USER, "1+1?"),
        message(ROLE_ASSISTANT, "2"),
        message(ROLE_USER, "а 2+2?"),
    ];
    let with_empty_assistant = vec![
        message(ROLE_USER, "1+1?"),
        message(ROLE_ASSISTANT, ""),
        message(ROLE_USER, "а 2+2?"),
    ];

    let thinking_off = RequestOptions {
        thinking: false,
        web_search: false,
    };
    let thinking_on = RequestOptions {
        thinking: true,
        web_search: false,
    };
    let with_web_search = RequestOptions {
        thinking: false,
        web_search: true,
    };

    run_stream_case(
        &client,
        "thinking=off (база)",
        request(&first.id, single.clone(), thinking_off.clone()),
    )
    .await;
    run_stream_case(
        &client,
        "thinking=on",
        request(&first.id, single.clone(), thinking_on),
    )
    .await;
    run_stream_case(
        &client,
        "мультитёрн",
        request(&first.id, multi, thinking_off.clone()),
    )
    .await;
    run_stream_case(
        &client,
        "пустой assistant в истории",
        request(&first.id, with_empty_assistant, thinking_off.clone()),
    )
    .await;
    run_stream_case(
        &client,
        "веб-поиск",
        request(&first.id, single.clone(), with_web_search),
    )
    .await;

    if let Some(always) = models.iter().find(|m| m.always_thinks) {
        run_stream_case(
            &client,
            "всегда рассуждающая модель",
            request(&always.id, single, thinking_off),
        )
        .await;
    }
}

/// Proves the router sends each model to its own vendor with every available
/// provider wired up at once.
async fn run_router_case(
    catalog: ModelCatalog,
    available: Vec<(&'static registry::LlmProviderSpec, String)>,
) {
    let anthropic_key = std::env::var(ANTHROPIC_KEY_ENV).unwrap_or_default();
    let mut providers: Vec<Arc<dyn LlmProvider>> = vec![Arc::new(
        harpyhare_lib::llm::AnthropicClient::new(anthropic_key).with_catalog(Arc::clone(&catalog)),
    )];
    for (spec, key) in &available {
        providers.push(Arc::new(ResponsesClient::direct(spec, key.clone())));
    }
    let router = ProviderRouter::new(providers, catalog);

    println!("── роутер ──");
    match router.list_models().await {
        Ok(models) => {
            let mut per_vendor: Vec<String> = Vec::new();
            for spec in registry::PROVIDERS {
                let n = models.iter().filter(|m| m.provider == spec.id).count();
                per_vendor.push(format!("{}={n}", spec.id));
            }
            println!("  [OK ] каталог роутера: {}", per_vendor.join(" "));
        }
        Err(e) => println!("  [ERR] роутер: {e}"),
    }
    for (spec, _) in &available {
        let Some(model) = spec.models().into_iter().next() else {
            continue;
        };
        run_stream_case(
            &router,
            &format!("роутер → {}", spec.id),
            request(
                &model.id,
                vec![message(ROLE_USER, "Столица Италии?")],
                RequestOptions::default(),
            ),
        )
        .await;
    }
}

fn main() {
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let _ = dotenvy::from_path(manifest.join(DESKTOP_ENV_PATH));
    let _ = dotenvy::from_path(manifest.join(WORKSPACE_ENV_PATH));

    let available: Vec<(&'static registry::LlmProviderSpec, String)> = registry::PROVIDERS
        .iter()
        .filter(|spec| matches!(spec.wire, registry::LlmWire::Responses { .. }))
        .filter_map(|spec| {
            let key = std::env::var(key_env_var(spec.key_id))
                .ok()
                .filter(|k| !k.is_empty());
            match key {
                Some(key) => Some((spec, key)),
                None => {
                    println!(
                        "[skip] {}: нет {} в .env",
                        spec.id,
                        key_env_var(spec.key_id)
                    );
                    None
                }
            }
        })
        .collect();

    if available.is_empty() {
        println!("нечего проверять: ни одного ключа вендора Responses в .env");
        return;
    }

    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async move {
        for (spec, key) in &available {
            run_vendor_cases(spec, key.clone()).await;
        }
        let catalog: ModelCatalog = Arc::new(Mutex::new(Vec::new()));
        run_router_case(catalog, available).await;
    });
}
