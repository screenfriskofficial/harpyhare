//! Live OpenRouter text check with a synthetic prompt. No real conversation data.
//! cargo run --example openrouter_smoke -- openai/gpt-4o-mini [--thinking]
//! Reads OPENROUTER_API_KEY from the workspace .env; never prints credentials.

use harpyhare_lib::llm::{
    openrouter::{OpenRouterClient, PROVIDER_OPENROUTER},
    registry,
    router::ProviderRouter,
    ChatMessage, LlmProvider, LlmRequest, LlmStreamSink, RequestOptions,
};
use std::sync::{Arc, Mutex};

#[derive(Default)]
struct Sink {
    text: String,
    tokens: u32,
}
impl LlmStreamSink for Sink {
    fn text_delta(&mut self, delta: &str) {
        self.text.push_str(delta);
    }
    fn input_tokens(&mut self, total: u32) {
        self.tokens = total;
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let _ = dotenvy::from_path(manifest.join("../../../.env"));
    let key = std::env::var("OPENROUTER_API_KEY").map_err(|_| "OPENROUTER_API_KEY is missing")?;
    let args: Vec<_> = std::env::args().skip(1).collect();
    let upstream = args
        .iter()
        .find(|arg| !arg.starts_with("--"))
        .map(String::as_str)
        .unwrap_or("openai/gpt-4o-mini");
    let model = format!("openrouter/{upstream}");
    let client = OpenRouterClient::new(registry::spec(PROVIDER_OPENROUTER).unwrap(), key);
    let router = ProviderRouter::new(vec![Arc::new(client)], Arc::new(Mutex::new(Vec::new())));
    let models = router.list_models().await?;
    let selected = models
        .iter()
        .find(|m| m.id == model)
        .ok_or("model is absent from text catalogue")?;
    println!(
        "{} text models; selected {}; context {}; thinking {}; mandatory {}",
        models.len(),
        selected.id,
        selected.max_input_tokens,
        selected.adaptive,
        selected.always_thinks
    );
    let request = LlmRequest {
        model,
        system: "Answer briefly in Russian, in one sentence.".into(),
        messages: vec![ChatMessage {
            role: "user".into(),
            text: "What is a goroutine in Go?".into(),
            images: vec![],
        }],
        options: RequestOptions {
            thinking: args.iter().any(|arg| arg == "--thinking"),
            web_search: false,
        },
    };
    let mut sink = Sink::default();
    let started = std::time::Instant::now();
    router
        .stream(
            request,
            tokio_util::sync::CancellationToken::new(),
            &mut sink,
        )
        .await?;
    if sink.text.trim().is_empty() || sink.tokens == 0 {
        return Err("missing answer or usage".into());
    }
    println!(
        "{}\n{} input tokens; {:?}",
        sink.text.trim(),
        sink.tokens,
        started.elapsed()
    );
    Ok(())
}
