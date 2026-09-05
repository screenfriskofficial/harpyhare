const DOTENV_RELATIVE_PATH: &str = "../.env";
const ANTHROPIC_KEY_ENV: &str = "ANTHROPIC_API_KEY";
const ANTHROPIC_MESSAGES_URL: &str = "https://api.anthropic.com/v1/messages";
const API_KEY_HEADER: &str = "x-api-key";
const ANTHROPIC_VERSION_HEADER: &str = "anthropic-version";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const OPUS_MODEL: &str = "claude-opus-4-8";
const BRIEF_SYSTEM: &str = "Кратко.";
const ROLE_USER: &str = "user";
const ROLE_ASSISTANT: &str = "assistant";
const MAX_TOKENS_FIELD: &str = "max_tokens";
const PROBE_MAX_TOKENS: u32 = 16;
const ERROR_BODY_PREVIEW_CHARS: usize = 400;
const HTTP_STATUS_OK: u16 = 200;
const NO_WEB_SEARCH: Option<serde_json::Value> = None;

fn chat_message(role: &str, text: &str) -> harpyhare_lib::llm::ChatMessage {
    harpyhare_lib::llm::ChatMessage {
        role: role.into(),
        text: text.into(),
        images: vec![],
    }
}

fn arithmetic_dialog(assistant_text: &str) -> Vec<harpyhare_lib::llm::ChatMessage> {
    vec![
        chat_message(ROLE_USER, "1+1?"),
        chat_message(ROLE_ASSISTANT, assistant_text),
        chat_message(ROLE_USER, "а 2+2?"),
    ]
}

fn probe_body(
    system: &str,
    messages: &[harpyhare_lib::llm::ChatMessage],
    thinking: bool,
) -> serde_json::Value {
    harpyhare_lib::llm::build_request_body(
        OPUS_MODEL,
        system,
        messages,
        harpyhare_lib::llm::thinking_value(None, OPUS_MODEL, thinking),
        NO_WEB_SEARCH,
    )
}

fn build_cases() -> Vec<(&'static str, serde_json::Value)> {
    let single = vec![chat_message(
        ROLE_USER,
        "Ответь одним словом: столица Франции?",
    )];
    let multi = arithmetic_dialog("2");
    let with_empty_assistant = arithmetic_dialog("");

    vec![
        ("opus thinking=on (база)", probe_body(BRIEF_SYSTEM, &single, true)),
        ("opus thinking=off", probe_body(BRIEF_SYSTEM, &single, false)),
        ("opus мультитёрн с кэшем", probe_body(BRIEF_SYSTEM, &multi, true)),
        (
            "opus пустой assistant в истории",
            probe_body(BRIEF_SYSTEM, &with_empty_assistant, true),
        ),
        ("opus без препромпта (system=\"\")", probe_body("", &single, true)),
    ]
}

async fn run_case(client: &reqwest::Client, key: &str, name: &str, mut body: serde_json::Value) {
    body[MAX_TOKENS_FIELD] = serde_json::json!(PROBE_MAX_TOKENS);
    let req = client
        .post(ANTHROPIC_MESSAGES_URL)
        .header(API_KEY_HEADER, key)
        .header(ANTHROPIC_VERSION_HEADER, ANTHROPIC_VERSION);
    match req.json(&body).send().await {
        Ok(resp) => {
            let status = resp.status().as_u16();
            if status == HTTP_STATUS_OK {
                println!("[OK ] {name}");
                drop(resp);
            } else {
                let text = resp.text().await.unwrap_or_default();
                let preview: String = text.chars().take(ERROR_BODY_PREVIEW_CHARS).collect();
                println!("[{status}] {name}: {preview}");
            }
        }
        Err(e) => println!("[NET] {name}: {e}"),
    }
}

fn main() {
    let _ = dotenvy::from_path(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(DOTENV_RELATIVE_PATH),
    );
    let key = std::env::var(ANTHROPIC_KEY_ENV).expect("ANTHROPIC_API_KEY в .env");

    let cases = build_cases();
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async move {
        harpyhare_lib::tls::ensure_crypto_provider();
        let client = reqwest::Client::new();
        for (name, body) in cases {
            run_case(&client, &key, name, body).await;
        }
    });
}
